/**
 * AgentForge Workflow Class
 *
 * High-level workflow orchestration above Agent.
 * Provides multi-step execution with suspend/resume capabilities.
 *
 * Design:
 * - Workflow.run(input, listener) calls listener() for each event, returns Promise<WorkflowResult>
 * - Each step internally calls executor.executeStep() with listener forwarding
 * - Events bubble up to the caller's listener
 *
 */

import { type AgentEvent, type AgentContext, generateId, serializeError } from '../core/index.js';
import {
  type WorkflowConfig,
  type WorkflowExecutionContext,
  type WorkflowResult,
} from './types.js';
import { WorkflowExecutor } from './executor.js';

// ============================================================
// Workflow Class
// ============================================================

/**
 * Workflow - Orchestrates multi-step agent execution
 *
 * A Workflow is a high-level abstraction above Agent that:
 * 1. Defines a sequence of steps, each invoking an agent
 * 2. Passes output from one step as input to the next
 * 3. Emits workflow.* events via listener callback
 * 4. Supports suspend/resume/cancel for long-running workflows
 *
 * @example
 * ```typescript
 * const workflow = new Workflow(config, agentContext);
 *
 * // Run workflow with event listener
 * const events: AgentEvent[] = [];
 * const result = await workflow.run({ topic: 'AI' }, (event) => {
 *   events.push(event);
 *   if (event.type.startsWith('workflow.')) {
 *     console.log('Workflow event:', event.type);
 *   }
 * });
 * console.log('Workflow result:', result.success);
 * ```
 */
export class Workflow {
  private config: WorkflowConfig;
  private agentContext: AgentContext;
  private executor: WorkflowExecutor;
  private destroyed = false;
  private suspended = false;
  private resumeResolve: (() => void) | null = null;
  private executionContext: WorkflowExecutionContext | null = null;

  constructor(config: WorkflowConfig, agentContext: AgentContext) {
    this.config = config;
    this.agentContext = agentContext;
    this.executor = new WorkflowExecutor(agentContext);
  }

  /**
   * Run the workflow with the given input
   *
   * Invokes listener for each event including:
   * - workflow.start, workflow.complete, workflow.error
   * - workflow.step.start, workflow.step.end for each step
   * - All nested agent events from step execution
   *
   * @param input - Initial workflow input
   * @param listener - Callback for each event emitted during execution
   * @returns Promise resolving to WorkflowResult
   */
  async run(input: unknown, listener: (event: AgentEvent) => void): Promise<WorkflowResult> {
    const startTime = Date.now();
    const workflowId = `wf-${generateId()}`;
    const sessionId = this.agentContext.sessionId;

    // Initialize execution context
    this.executionContext = {
      workflowId,
      state: 'pending',
      currentStepIndex: 0,
      totalSteps: this.config.steps.length,
      stepOutputs: new Map(),
    };

    // Emit workflow.start event
    listener({
      type: 'workflow.start',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      workflowName: this.config.name,
    });

    this.executionContext = { ...this.executionContext, state: 'running' };

    let stopped = false;
    let stepError:
      | { name: string; message: string; stack?: string | undefined; stepId?: string }
      | undefined;
    let stepsCompleted = 0;

    try {
      // Execute steps sequentially
      let currentInput = input;

      for (let index = 0; index < this.config.steps.length; index++) {
        // Check destroy/cancel flag
        if (this.destroyed) {
          stopped = true;
          break;
        }

        // Check suspend flag — wait until resumed
        if (this.suspended) {
          await this.waitForResume();
          this.suspended = false;
        }

        // Re-check after resume
        if (this.destroyed) {
          stopped = true;
          break;
        }

        const step = this.config.steps[index]!;

        // Get previous step output if available
        if (index > 0) {
          const prevStep = this.config.steps[index - 1];
          if (prevStep) {
            const prevOutput = this.executionContext?.stepOutputs.get(prevStep.id);
            if (prevOutput !== undefined) {
              currentInput = prevOutput;
            }
          }
        }

        // Check skip condition
        if (step.skip && step.skip(currentInput)) {
          listener({
            type: 'workflow.step.end',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            stepId: step.id,
            result: 'skipped',
          });
          this.executionContext = {
            ...this.executionContext,
            currentStepIndex: index + 1,
          };
          stepsCompleted++;
          continue;
        }

        // Execute step via executor — forward all events to caller's listener
        // but also capture output for next step
        let capturedOutput: unknown;
        let capturedError: import('../core/events.js').SerializedError | undefined;

        const stepResult = await this.executor.executeStep(
          step,
          currentInput,
          workflowId,
          event => {
            // Capture output for step chaining
            if (event.type === 'agent.complete') {
              capturedOutput = event.output;
              this.executionContext?.stepOutputs.set(step.id, capturedOutput);
            }
            if (event.type === 'agent.error') {
              capturedError = event.error;
            }
            // Forward all events to caller
            listener(event);
          }
        );

        this.executionContext = {
          ...this.executionContext,
          currentStepIndex: index + 1,
        };

        if (stepResult.result === 'failure') {
          stepsCompleted++;

          if (!this.config.continueOnFailure) {
            stepError = capturedError
              ? { ...capturedError, stepId: step.id }
              : { name: 'StepError', message: `Step ${step.id} failed`, stepId: step.id };
            stopped = true;
            break;
          }
          // Continue on failure — record but keep going
        } else {
          stepsCompleted++;
        }

        // After step completes, update currentInput for next iteration
        const output = this.executionContext?.stepOutputs.get(step.id);
        if (output !== undefined) {
          currentInput = output;
        }
      }

      // Determine final result
      if (stopped || this.destroyed) {
        // Emit workflow.error if stopped
        if (stepError) {
          listener({
            type: 'workflow.error',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            error: serializeError(stepError),
          });
        }

        this.executionContext = {
          ...this.executionContext,
          state: this.destroyed ? 'cancelled' : 'failed',
        };

        // Emit workflow.complete with partial results
        listener({
          type: 'workflow.complete',
          timestamp: Date.now(),
          sessionId,
          workflowId,
          result: this.executionContext.stepOutputs
            ? Object.fromEntries(this.executionContext.stepOutputs)
            : undefined,
        });

        const errorResult: WorkflowResult = {
          success: false,
          stepsCompleted,
          totalSteps: this.config.steps.length,
          durationMs: Date.now() - startTime,
          stepOutputs: this.executionContext.stepOutputs
            ? Object.fromEntries(this.executionContext.stepOutputs)
            : {},
        };
        if (stepError) {
          const err: WorkflowResult['error'] = {
            name: stepError.name,
            message: stepError.message,
          };
          if (stepError.stack) err.stack = stepError.stack;
          if (stepError.stepId) err.stepId = stepError.stepId;
          errorResult.error = err;
        }
        return errorResult;
      }

      // Success — emit workflow.complete
      this.executionContext = { ...this.executionContext, state: 'completed' };

      const stepOutputs = this.executionContext.stepOutputs
        ? Object.fromEntries(this.executionContext.stepOutputs)
        : {};

      listener({
        type: 'workflow.complete',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        result: stepOutputs,
      });

      return {
        success: true,
        stepsCompleted,
        totalSteps: this.config.steps.length,
        durationMs: Date.now() - startTime,
        stepOutputs,
      };
    } catch (error) {
      // Unexpected error during workflow execution
      const serialized = serializeError(error);

      listener({
        type: 'workflow.error',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        error: serialized,
      });

      this.executionContext = { ...this.executionContext, state: 'failed' };

      listener({
        type: 'workflow.complete',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        result: this.executionContext.stepOutputs
          ? Object.fromEntries(this.executionContext.stepOutputs)
          : undefined,
      });

      const catchError: WorkflowResult = {
        success: false,
        stepsCompleted,
        totalSteps: this.config.steps.length,
        durationMs: Date.now() - startTime,
        stepOutputs: this.executionContext.stepOutputs
          ? Object.fromEntries(this.executionContext.stepOutputs)
          : {},
      };
      const errInfo: NonNullable<WorkflowResult['error']> = {
        name: serialized.name,
        message: serialized.message,
      };
      if (serialized.stack !== undefined) errInfo.stack = serialized.stack;
      catchError.error = errInfo;
      return catchError;
    }
  }

  /**
   * Suspend workflow execution
   *
   * Sets suspend flag. The run() loop will pause at the next step start.
   */
  suspend(_reason: string): void {
    if (this.executionContext?.state !== 'running') {
      return;
    }

    this.suspended = true;
    this.executionContext = {
      ...this.executionContext,
      state: 'suspended',
      suspensionReason: _reason,
    };
  }

  /**
   * Resume workflow execution
   *
   * Clears suspend flag and resolves the pending promise to continue.
   */
  resume(): void {
    if (this.executionContext?.state !== 'suspended') {
      return;
    }

    // Resolve the pending wait to continue the loop
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumeResolve = null;
    }

    this.executionContext = { ...this.executionContext, state: 'running' };
  }

  /**
   * Cancel workflow execution
   *
   * Sets destroy flag. The run() loop will stop at the next step start.
   */
  cancel(_reason: string): void {
    this.destroyed = true;

    // If suspended, resolve to unblock
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumeResolve = null;
    }

    if (
      this.executionContext?.state === 'running' ||
      this.executionContext?.state === 'suspended'
    ) {
      this.executionContext = { ...this.executionContext, state: 'cancelled' };
    }
  }

  /**
   * Get current execution context
   */
  getExecutionContext(): WorkflowExecutionContext | null {
    return this.executionContext;
  }

  /**
   * Destroy the workflow and clean up resources
   */
  destroy(): void {
    this.destroyed = true;

    // Resolve any pending suspend to unblock
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumeResolve = null;
    }

    this.executionContext = null;
  }

  /**
   * Wait for resume — returns a promise that resolves on resume() or cancel()
   */
  private waitForResume(): Promise<void> {
    return new Promise(resolve => {
      this.resumeResolve = resolve;
    });
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a workflow instance
 *
 * @param config - Workflow configuration
 * @param agentContext - Agent context for execution
 * @returns Workflow instance
 */
export function createWorkflow(config: WorkflowConfig, agentContext: AgentContext): Workflow {
  return new Workflow(config, agentContext);
}
