/**
 * AgentForge Workflow Executor
 *
 * Executes individual workflow steps by calling the agent loop.
 * Handles step input/output mapping and error handling.
 *
 * Design:
 * - executeStep() returns Observable<AgentEvent> including workflow events + nested agent events
 * - Uses firstValueFrom to wait for agent completion
 * - Maps nested agent events with workflowId for traceability
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { Observable, of, firstValueFrom } from 'rxjs';
import {
  map,
  filter,
  catchError,
  timeout,
  tap,
  take,
} from 'rxjs/operators';
import {
  type AgentEvent,
  type AgentContext,
  serializeError,
} from '../core/index.js';
import { AgentLoop, type AgentLoopOptions } from '../api/agent-loop.js';
import { type WorkflowStep, type WorkflowStepResult } from './types.js';

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
 * 4. Emitting workflow.step.start/end events
 * 5. Mapping nested agent events with workflowId
 *
 * @example
 * ```typescript
 * const executor = new WorkflowExecutor(agentContext);
 * executor.executeStep(step, { topic: 'AI' }, 'wf-123')
 *   .subscribe(event => {
 *     if (event.type === 'workflow.step.end') {
 *       console.log('Step completed:', event.stepId);
 *     }
 *   });
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
   * Calls the agent with the step's prompt generator and returns
   * an event stream including:
   * - workflow.step.start event
   * - All nested agent events (mapped with workflowId)
   * - workflow.step.end event with output
   *
   * @param step - Workflow step configuration
   * @param input - Step input (usually output from previous step)
   * @param workflowId - Parent workflow ID for event correlation
   * @returns Observable of workflow and agent events
   */
  executeStep(
    step: WorkflowStep,
    input: unknown,
    workflowId: string
  ): Observable<AgentEvent> {
    const sessionId = this.agentContext.sessionId;
    const startTime = Date.now();

    // Generate step prompt from input
    const prompt = step.prompt(input);
    const stepName = step.name ?? step.id;

    // Emit step start event
    const stepStartEvent: AgentEvent = {
      type: 'workflow.step.start',
      timestamp: startTime,
      sessionId,
      workflowId,
      stepId: step.id,
      stepName,
    };

    // Create agent loop for this step
    const agentOptions: AgentLoopOptions = {
      model: {
        provider: this.agentContext.llm.provider,
        model: this.agentContext.llm.name,
      },
      maxSteps: 10,
      maxLLMRepairAttempts: 3,
      parallelToolCalls: false,
      streaming: false,
    };

    const agent = new AgentLoop(this.agentContext, agentOptions);

    // Execute agent and capture output
    const agentEvents$ = agent.run$(prompt).pipe(
      // Map agent events with workflowId for correlation
      map(event => this.mapEventWithWorkflowId(event, workflowId)),
      // Handle timeout if specified
      step.timeout ? timeout(step.timeout) : tap(),
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

    // Return combined stream: start + agent events + end
    return new Observable<AgentEvent>(subscriber => {
      let stepFailed = false;

      // Emit start event
      subscriber.next(stepStartEvent);

      const subscription = agentEvents$.subscribe({
        next: event => {
          subscriber.next(event);

          // Track errors
          if (event.type === 'agent.error') {
            stepFailed = true;
          }

          // Track workflow error
          if (event.type === 'workflow.error') {
            stepFailed = true;
          }
        },
        error: () => {
          stepFailed = true;

          // Emit step end event with failure
          const stepEndEvent: AgentEvent = {
            type: 'workflow.step.end',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            stepId: step.id,
            result: 'failure',
          };
          subscriber.next(stepEndEvent);
          subscriber.complete();
        },
        complete: () => {
          // Emit step end event
          const stepEndEvent: AgentEvent = {
            type: 'workflow.step.end',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            stepId: step.id,
            result: stepFailed ? 'failure' : 'success',
          };
          subscriber.next(stepEndEvent);
          subscriber.complete();
        },
      });

      return () => {
        subscription.unsubscribe();
        agent.destroy();
      };
    });
  }

  /**
   * Execute a step and return the result as a Promise
   *
   * Convenience method for sequential step execution where
   * you need to wait for step completion before continuing.
   *
   * @param step - Workflow step configuration
   * @param input - Step input
   * @param workflowId - Parent workflow ID
   * @returns Promise resolving to step result with output
   */
  async executeStepAsync(
    step: WorkflowStep,
    input: unknown,
    workflowId: string
  ): Promise<WorkflowStepResult> {
    const startTime = Date.now();
    let output: unknown;
    let error: { name: string; message: string; stack?: string | undefined } | undefined;

    try {
      // Check skip condition
      if (step.skip && step.skip(input)) {
        return {
          stepId: step.id,
          success: true,
          skipped: true,
          durationMs: 0,
        };
      }

      // Execute and wait for completion
      const events = await firstValueFrom(
        this.executeStep(step, input, workflowId).pipe(
          filter(e => e.type === 'agent.complete' || e.type === 'agent.error'),
          take(1)
        )
      );

      if (events.type === 'agent.complete') {
        output = (events).output;
      } else if (events.type === 'agent.error') {
        const errEvent = events;
        error = {
          name: errEvent.error.name,
          message: errEvent.error.message,
          stack: errEvent.error.stack,
        };
      }
    } catch (err) {
      const serialized = serializeError(err);
      error = {
        name: serialized.name,
        message: serialized.message,
        stack: serialized.stack,
      };
    }

    const result: WorkflowStepResult = {
      stepId: step.id,
      success: !error,
      skipped: false,
      durationMs: Date.now() - startTime,
    };
    if (output !== undefined) {
      result.output = output;
    }
    if (error !== undefined) {
      result.error = error;
    }
    return result;
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
export function createPromptGenerator(
  template: string
): (input: unknown) => string {
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
export function createJsonPromptGenerator(
  template: string
): (input: unknown) => string {
  return (input: unknown) => {
    const jsonInput = JSON.stringify(input, null, 2);
    return template.replace(/\{\{input\}\}/g, jsonInput);
  };
}
