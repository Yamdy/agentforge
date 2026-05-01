/**
 * AgentForge Workflow Executor
 *
 * Executes individual workflow steps by calling the agent loop.
 * Handles step input/output mapping and error handling.
 *
 * Design:
 * - executeStep() is an async function with a listener callback for events
 * - Calls loop.onAny() to capture agent events and forward them
 * - Returns step execution result (success/failure + output/error)
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 * @see docs/design/25-DE-RXJS.md
 */

import { type AgentEvent, type AgentContext, type SerializedError, serializeError } from '../core/index.js';
import { createAgentLoop } from '../loop/agent-loop.js';
import { type WorkflowStep, type WorkflowStepResult } from './types.js';

// ============================================================
// Step Execution Result
// ============================================================

/**
 * Result from executing a single workflow step
 */
export interface StepExecutionResult {
  /** Step ID */
  stepId: string;
  /** Execution result: 'success' or 'failure' */
  result: 'success' | 'failure';
  /** Output from agent.complete event (if successful) */
  output?: unknown;
  /** Error from agent.error event (if failed) */
  error?: SerializedError;
}

// ============================================================
// Workflow Executor
// ============================================================

/**
 * WorkflowExecutor - Executes workflow steps via agent loop
 *
 * Responsible for:
 * 1. Creating agent loop per step (or reusing a shared agent)
 * 2. Calling agent.run(step.prompt(input))
 * 3. Extracting output from agent.complete event
 * 4. Emitting workflow.step.start/end events via listener
 * 5. Mapping nested agent events with workflowId
 *
 * @example
 * ```typescript
 * const executor = new WorkflowExecutor(agentContext);
 * const events: AgentEvent[] = [];
 * const result = await executor.executeStep(
 *   step,
 *   { topic: 'AI' },
 *   'wf-123',
 *   (event) => { events.push(event); }
 * );
 * console.log('Step result:', result.result);
 * ```
 */
export class WorkflowExecutor {
  private agentContext: AgentContext;

  constructor(agentContext: AgentContext) {
    this.agentContext = agentContext;
  }

  /**
   * Execute a workflow step
   *
   * Calls the agent with the step's prompt generator and invokes
   * the listener callback for each event, including:
   * - workflow.step.start event
   * - All nested agent events (mapped with workflowId)
   * - workflow.step.end event with output
   *
   * On error, also emits workflow.error before step.end.
   *
   * @param step - Workflow step configuration
   * @param input - Step input (usually output from previous step)
   * @param workflowId - Parent workflow ID for event correlation
   * @param listener - Callback invoked for each event emitted during execution
   * @returns Promise resolving to step execution result
   */
  async executeStep(
    step: WorkflowStep,
    input: unknown,
    workflowId: string,
    listener: (event: AgentEvent) => void
  ): Promise<StepExecutionResult> {
    const sessionId = this.agentContext.sessionId;
    const startTime = Date.now();

    const prompt = step.prompt(input);
    const stepName = step.name ?? step.id;

    // Emit workflow.step.start event
    listener({
      type: 'workflow.step.start',
      timestamp: startTime,
      sessionId,
      workflowId,
      stepId: step.id,
      stepName,
    });

    let stepOutput: unknown;
    let stepError: SerializedError | undefined;

    try {
      const loop = createAgentLoop(this.agentContext, {
        model: { provider: this.agentContext.llm.provider, model: this.agentContext.llm.name },
        maxSteps: 10,
        maxLLMRepairAttempts: 3,
        parallelToolCalls: false,
        streaming: false,
      });

      loop.onAny(event => {
        const mapped = this.mapEventWithWorkflowId(event, workflowId);
        if (mapped.type === 'agent.error') {
          stepError = (mapped as any).error;
        }
        if (mapped.type === 'agent.complete') {
          stepOutput = (mapped as any).output;
        }
        listener(mapped);
      });

      await loop.run(prompt);

      // Emit workflow.step.end event
      listener({
        type: 'workflow.step.end',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        stepId: step.id,
        result: stepError ? 'failure' : 'success',
      });

      const result: StepExecutionResult = {
        stepId: step.id,
        result: stepError ? 'failure' : 'success',
      };
      if (stepOutput !== undefined) result.output = stepOutput;
      if (stepError !== undefined) result.error = stepError;
      return result;
    } catch (error) {
      const serialized = serializeError(error);

      // Emit workflow.error event
      listener({
        type: 'workflow.error',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        error: serialized,
        stepId: step.id,
      });

      // Emit workflow.step.end with failure
      listener({
        type: 'workflow.step.end',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        stepId: step.id,
        result: 'failure',
      });

      return {
        stepId: step.id,
        result: 'failure' as const,
        error: serialized,
      };
    }
  }

  /**
   * Execute a step and return the result as a Promise
   *
   * Convenience method for sequential step execution where
   * you need to wait for step completion before continuing.
   *
   * @param step - Workflow step configuration
   * @param input - Step input
   * @param _workflowId - Parent workflow ID
   * @returns Promise resolving to step result with output
   */
  async executeStepAsync(
    step: WorkflowStep,
    input: unknown,
    workflowId: string
  ): Promise<WorkflowStepResult> {
    const startTime = Date.now();

    // Check skip condition
    if (step.skip && step.skip(input)) {
      return {
        stepId: step.id,
        success: true,
        skipped: true,
        durationMs: 0,
      };
    }

    const events: AgentEvent[] = [];
    const result = await this.executeStep(step, input, workflowId, event => {
      events.push(event);
    });

    const workflowStepResult: WorkflowStepResult = {
      stepId: step.id,
      success: result.result === 'success',
      skipped: false,
      durationMs: Date.now() - startTime,
    };

    if (result.output !== undefined) {
      workflowStepResult.output = result.output;
    }
    if (result.error !== undefined) {
      workflowStepResult.error = {
        name: result.error.name,
        message: result.error.message,
      };
      if (result.error.stack !== undefined) {
        workflowStepResult.error.stack = result.error.stack;
      }
    }

    return workflowStepResult;
  }

  /**
   * Map nested agent events with workflowId for correlation
   */
  private mapEventWithWorkflowId(event: AgentEvent, _workflowId: string): AgentEvent {
    // For workflow events, pass through as-is
    if (event.type.startsWith('workflow.')) {
      return event;
    }

    // For agent events, we don't modify the event structure
    // but the correlation is available through the sessionId
    // which links back to the workflow execution context
    return event;
  }
}

// ============================================================
// Step Execution Helpers
// ============================================================

/**
 * Create a simple prompt generator from a template
 */
export function createPromptGenerator(template: string): (input: unknown) => string {
  return (input: unknown) => {
    if (typeof input === 'string') {
      return template.replace(/\{\{input\}\}/g, input);
    }
    return template.replace(/\{\{input\}\}/g, JSON.stringify(input));
  };
}

/**
 * Create a JSON-based prompt generator for structured input
 */
export function createJsonPromptGenerator(template: string): (input: unknown) => string {
  return (input: unknown) => {
    const jsonInput = JSON.stringify(input, null, 2);
    return template.replace(/\{\{input\}\}/g, jsonInput);
  };
}
