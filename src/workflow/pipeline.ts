/**
 * AgentForge Pipeline Implementations
 *
 * Provides SequentialPipeline and ParallelPipeline for workflow
 * step orchestration.
 *
 * SequentialPipeline:
 * - Executes steps in order, passing output from one step to next
 * - Uses concatMap for sequential execution
 *
 * ParallelPipeline:
 * - Executes all steps simultaneously with same input
 * - Uses mergeMap for concurrent execution
 * - Results merged when all complete
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { Observable, of, from, Subject } from 'rxjs';
import { concatMap, mergeMap, takeUntil, catchError, tap } from 'rxjs/operators';
import { type AgentEvent, type AgentContext, serializeError, generateId } from '../core/index.js';
import { WorkflowExecutor } from './executor.js';
import { type WorkflowStep, type PipelineConfig } from './types.js';

// ============================================================
// Sequential Pipeline
// ============================================================

/**
 * SequentialPipeline - Execute steps one after another
 *
 * Each step receives the output of the previous step as its input.
 * If a step fails, subsequent steps are not executed unless
 * continueOnFailure is true.
 *
 * @example
 * ```typescript
 * const pipeline = new SequentialPipeline([
 *   { id: 'step1', prompt: (input) => `Analyze: ${input}` },
 *   { id: 'step2', prompt: (input) => `Summarize: ${input}` },
 * ]);
 *
 * pipeline.run('AI trends', agentContext).subscribe({
 *   next: (event) => console.log(event.type),
 *   complete: () => console.log('Pipeline completed'),
 * });
 * ```
 */
export class SequentialPipeline {
  private steps: WorkflowStep[];
  private executor: WorkflowExecutor;
  private agentContext: AgentContext;
  private continueOnFailure: boolean;
  private destroy$ = new Subject<void>();

  constructor(
    steps: WorkflowStep[],
    agentContext: AgentContext,
    options?: { continueOnFailure?: boolean }
  ) {
    this.steps = steps;
    this.agentContext = agentContext;
    this.executor = new WorkflowExecutor(agentContext);
    this.continueOnFailure = options?.continueOnFailure ?? false;
  }

  /**
   * Run the pipeline with initial input
   *
   * Executes steps sequentially, passing output from each step
   * to the next step in the chain.
   *
   * @param input - Initial pipeline input
   * @returns Observable of workflow and agent events
   */
  run(input: unknown): Observable<AgentEvent> {
    const workflowId = `pipeline-${generateId()}`;
    const sessionId = this.agentContext.sessionId;

    // Track current step index and accumulated output
    let currentInput = input;
    const stepOutputs = new Map<string, unknown>();

    // Create workflow start event
    const startEvent: AgentEvent = {
      type: 'workflow.start',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      workflowName: 'SequentialPipeline',
    };

    // Execute steps sequentially
    const steps$ = from(this.steps).pipe(
      concatMap((step, index) => {
        // Get previous step output if available
        if (index > 0) {
          const prevStep = this.steps[index - 1];
          if (prevStep) {
            const prevOutput = stepOutputs.get(prevStep.id);
            if (prevOutput !== undefined) {
              currentInput = prevOutput;
            }
          }
        }

        // Check skip condition
        if (step.skip && step.skip(currentInput)) {
          return of<AgentEvent>({
            type: 'workflow.step.end',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            stepId: step.id,
            result: 'skipped',
          });
        }

        // Execute step
        return this.executor.executeStep(step, currentInput, workflowId).pipe(
          tap(event => {
            // Capture output for next step
            if (event.type === 'agent.complete') {
              const output = event.output;
              stepOutputs.set(step.id, output);
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
            if (!this.continueOnFailure) {
              // Rethrow to stop pipeline
              throw error;
            }
            return of(errorEvent);
          })
        );
      }),
      takeUntil(this.destroy$)
    );

    return new Observable<AgentEvent>(subscriber => {
      subscriber.next(startEvent);

      const subscription = steps$.subscribe({
        next: event => subscriber.next(event),
        error: error => {
          subscriber.error(error);
        },
        complete: () => {
          const completeEvent: AgentEvent = {
            type: 'workflow.complete',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            result: Object.fromEntries(stepOutputs),
          };
          subscriber.next(completeEvent);
          subscriber.complete();
        },
      });

      return () => subscription.unsubscribe();
    });
  }

  /**
   * Stop pipeline execution
   */
  stop(): void {
    this.destroy$.next();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

// ============================================================
// Parallel Pipeline
// ============================================================

/**
 * ParallelPipeline - Execute all steps simultaneously
 *
 * All steps receive the same input and execute concurrently.
 * Results are collected when all steps complete and merged.
 *
 * Use maxConcurrency to limit concurrent executions.
 *
 * @example
 * ```typescript
 * const pipeline = new ParallelPipeline([
 *   { id: 'search', prompt: () => 'Search for X' },
 *   { id: 'analyze', prompt: () => 'Analyze Y' },
 * ], agentContext, { maxConcurrency: 2 });
 *
 * pipeline.run('input', agentContext).subscribe({
 *   next: (event) => console.log(event.type),
 * });
 * ```
 */
export class ParallelPipeline {
  private steps: WorkflowStep[];
  private executor: WorkflowExecutor;
  private agentContext: AgentContext;
  private maxConcurrency: number;
  private continueOnFailure: boolean;
  private destroy$ = new Subject<void>();

  constructor(
    steps: WorkflowStep[],
    agentContext: AgentContext,
    options?: { maxConcurrency?: number; continueOnFailure?: boolean }
  ) {
    this.steps = steps;
    this.agentContext = agentContext;
    this.executor = new WorkflowExecutor(agentContext);
    this.maxConcurrency = options?.maxConcurrency ?? 4;
    this.continueOnFailure = options?.continueOnFailure ?? true;
  }

  /**
   * Run the pipeline with input
   *
   * Executes all steps in parallel with the same input.
   * Results are merged when all complete.
   *
   * @param input - Input passed to all steps
   * @returns Observable of workflow and agent events
   */
  run(input: unknown): Observable<AgentEvent> {
    const workflowId = `pipeline-${generateId()}`;
    const sessionId = this.agentContext.sessionId;

    // Create workflow start event
    const startEvent: AgentEvent = {
      type: 'workflow.start',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      workflowName: 'ParallelPipeline',
    };

    // Track step outputs
    const stepOutputs = new Map<string, unknown>();

    // Execute all steps in parallel with concurrency limit
    const steps$ = from(this.steps).pipe(
      mergeMap(step => {
        // Check skip condition
        if (step.skip && step.skip(input)) {
          return of<AgentEvent>({
            type: 'workflow.step.end',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            stepId: step.id,
            result: 'skipped',
          });
        }

        return this.executor.executeStep(step, input, workflowId).pipe(
          tap(event => {
            if (event.type === 'agent.complete') {
              const output = event.output;
              stepOutputs.set(step.id, output);
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
            if (!this.continueOnFailure) {
              throw error;
            }
            return of(errorEvent);
          })
        );
      }, this.maxConcurrency),
      takeUntil(this.destroy$)
    );

    return new Observable<AgentEvent>(subscriber => {
      subscriber.next(startEvent);

      const subscription = steps$.subscribe({
        next: event => subscriber.next(event),
        error: error => {
          subscriber.error(error);
        },
        complete: () => {
          const completeEvent: AgentEvent = {
            type: 'workflow.complete',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            result: Object.fromEntries(stepOutputs),
          };
          subscriber.next(completeEvent);
          subscriber.complete();
        },
      });

      return () => subscription.unsubscribe();
    });
  }

  /**
   * Stop pipeline execution
   */
  stop(): void {
    this.destroy$.next();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

// ============================================================
// Pipeline Factory
// ============================================================

/**
 * Create a pipeline based on configuration
 */
export function createPipeline(
  config: PipelineConfig,
  agentContext: AgentContext
): SequentialPipeline | ParallelPipeline {
  if (config.mode === 'sequential') {
    const opts: { continueOnFailure?: boolean } = {};
    if (config.continueOnFailure !== undefined) {
      opts.continueOnFailure = config.continueOnFailure;
    }
    return new SequentialPipeline(config.steps, agentContext, opts);
  }

  const opts: { maxConcurrency?: number; continueOnFailure?: boolean } = {};
  if (config.maxConcurrency !== undefined) {
    opts.maxConcurrency = config.maxConcurrency;
  }
  if (config.continueOnFailure !== undefined) {
    opts.continueOnFailure = config.continueOnFailure;
  }
  return new ParallelPipeline(config.steps, agentContext, opts);
}

/**
 * Create a sequential pipeline
 */
export function createSequentialPipeline(
  steps: WorkflowStep[],
  agentContext: AgentContext,
  options?: { continueOnFailure?: boolean }
): SequentialPipeline {
  return new SequentialPipeline(steps, agentContext, options);
}

/**
 * Create a parallel pipeline
 */
export function createParallelPipeline(
  steps: WorkflowStep[],
  agentContext: AgentContext,
  options?: { maxConcurrency?: number; continueOnFailure?: boolean }
): ParallelPipeline {
  return new ParallelPipeline(steps, agentContext, options);
}
