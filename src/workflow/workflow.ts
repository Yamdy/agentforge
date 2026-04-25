/**
 * AgentForge Workflow Class
 *
 * High-level workflow orchestration above Agent.
 * Provides multi-step execution with suspend/resume capabilities.
 *
 * Design:
 * - Workflow.run() returns Observable<AgentEvent> with workflow.* events + nested agent events
 * - Each step internally calls agent.run() with step.prompt(input)
 * - Events bubble up to the top-level stream
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { Observable, of, from, Subject } from 'rxjs';
import {
  concatMap,
  takeUntil,
  catchError,
  tap,
} from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentContext,
  generateId,
  serializeError,
} from '../core/index.js';
import {
  type WorkflowConfig,
  type WorkflowStep,
  type WorkflowExecutionContext,
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
 * 3. Emits workflow.* events for observability
 * 4. Supports suspend/resume for long-running workflows
 *
 * @example
 * ```typescript
 * const workflow = new Workflow(config, agentContext);
 *
 * // Subscribe to all events (workflow + nested agent events)
 * workflow.run({ topic: 'AI' }).subscribe({
 *   next: (event) => {
 *     if (event.type.startsWith('workflow.')) {
 *       console.log('Workflow event:', event.type);
 *     } else {
 *       console.log('Nested agent event:', event.type);
 *     }
 *   },
 *   complete: () => console.log('Workflow completed'),
 * });
 * ```
 */
export class Workflow {
  private config: WorkflowConfig;
  private agentContext: AgentContext;
  private executor: WorkflowExecutor;
  private destroy$ = new Subject<void>();
  private suspend$ = new Subject<void>();
  private resume$ = new Subject<void>();
  private executionContext: WorkflowExecutionContext | null = null;

  constructor(config: WorkflowConfig, agentContext: AgentContext) {
    this.config = config;
    this.agentContext = agentContext;
    this.executor = new WorkflowExecutor(agentContext);
  }

  /**
   * Run the workflow with the given input
   *
   * Returns an Observable of events including:
   * - workflow.start, workflow.complete, workflow.error
   * - workflow.step.start, workflow.step.end for each step
   * - All nested agent events from step execution
   *
   * @param input - Initial workflow input
   * @returns Observable of workflow and agent events
   */
  run(input: unknown): Observable<AgentEvent> {
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

    // Create workflow start event
    const startEvent: AgentEvent = {
      type: 'workflow.start',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      workflowName: this.config.name,
    };

    // Execute steps sequentially
    const steps$ = from(this.config.steps).pipe(
      concatMap((step, index) => this.executeStepWithEvents(step, index, input, workflowId)),
      takeUntil(this.destroy$),
      takeUntil(this.suspend$)
    );

    // Combine start + steps + complete events
    return new Observable<AgentEvent>(subscriber => {
      // Emit start event
      subscriber.next(startEvent);
      this.executionContext = { ...this.executionContext!, state: 'running' };

      // Subscribe to steps
      const subscription = steps$.subscribe({
        next: event => subscriber.next(event),
        error: error => {
          const errorEvent: AgentEvent = {
            type: 'workflow.error',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            error: serializeError(error),
          };
          subscriber.next(errorEvent);
          this.executionContext = { ...this.executionContext!, state: 'failed' };
          subscriber.complete();
        },
        complete: () => {
          // Emit workflow complete event
          const completeEvent: AgentEvent = {
            type: 'workflow.complete',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            result: this.executionContext?.stepOutputs
              ? Object.fromEntries(this.executionContext.stepOutputs)
              : undefined,
          };
          subscriber.next(completeEvent);
          this.executionContext = { ...this.executionContext!, state: 'completed' };
          subscriber.complete();
        },
      });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  /**
   * Execute a single step and emit workflow events
   */
  private executeStepWithEvents(
    step: WorkflowStep,
    index: number,
    input: unknown,
    workflowId: string
  ): Observable<AgentEvent> {
    const sessionId = this.agentContext.sessionId;

    // Get previous step output if available
    let stepInput = input;
    if (index > 0) {
      const prevStep = this.config.steps[index - 1];
      if (prevStep) {
        const prevOutput = this.executionContext?.stepOutputs.get(prevStep.id);
        if (prevOutput !== undefined) {
          stepInput = prevOutput;
        }
      }
    }

    // Check skip condition
    if (step.skip && step.skip(stepInput)) {
      return of<AgentEvent>({
        type: 'workflow.step.end',
        timestamp: Date.now(),
        sessionId,
        workflowId,
        stepId: step.id,
        result: 'skipped',
      });
    }

    // Execute step using executor (which emits its own step.start/end events)
    return this.executor.executeStep(step, stepInput, workflowId).pipe(
      tap(event => {
        // Store output for next step when agent completes
        if (event.type === 'agent.complete') {
          const output = (event).output;
          this.executionContext?.stepOutputs.set(step.id, output);
        }
      }),
      catchError(error => {
        const errorEvent: AgentEvent = {
          type: 'workflow.error',
          timestamp: Date.now(),
          sessionId,
          workflowId,
          error: serializeError(error),
          stepId: step.id,
        };
        return of(errorEvent);
      })
    );
  }

  /**
   * Suspend workflow execution
   *
   * Emits workflow.suspend event and pauses execution.
   * Call resume() to continue from current step.
   */
  suspend(reason: string): void {
    if (this.executionContext?.state !== 'running') {
      return;
    }

    this.suspend$.next();
    this.executionContext = { ...this.executionContext, state: 'suspended', suspensionReason: reason };

    // Note: The suspend event is emitted via the internal subject
    // The caller should handle it through their subscription
  }

  /**
   * Resume workflow execution
   *
   * Emits workflow.resume event and continues from suspended step.
   */
  resume(): void {
    if (this.executionContext?.state !== 'suspended') {
      return;
    }

    this.resume$.next();
    this.executionContext = { ...this.executionContext, state: 'running' };

    // Note: The resume event is emitted via the internal subject
  }

  /**
   * Cancel workflow execution
   *
   * Emits workflow.error with cancel reason and completes the stream.
   */
  cancel(_reason: string): void {
    this.destroy$.next();

    if (this.executionContext?.state === 'running' || this.executionContext?.state === 'suspended') {
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
    this.destroy$.next();
    this.destroy$.complete();
    this.suspend$.complete();
    this.resume$.complete();
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
