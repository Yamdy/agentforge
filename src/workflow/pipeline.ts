/**
 * AgentForge Pipeline Implementations
 *
 * Provides SequentialPipeline and ParallelPipeline for workflow
 * step orchestration.
 *
 * SequentialPipeline:
 * - Executes steps in order, passing output from one step to next
 * - Uses sequential async calls
 *
 * ParallelPipeline:
 * - Executes all steps simultaneously with same input
 * - Uses Promise.all with concurrency limiting
 * - Results merged when all complete
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 * @see docs/design/25-DE-RXJS.md
 */

import { type AgentEvent, type AgentContext, serializeError, generateId } from '../core/index.js';
import { WorkflowExecutor } from './executor.js';
import { type WorkflowStep, type PipelineConfig } from './types.js';

// ============================================================
// Pipeline Result
// ============================================================

/**
 * Result from a pipeline execution
 */
export interface PipelineResult {
  /** Whether all steps completed successfully (or with continueOnFailure) */
  success: boolean;
  /** Step outputs by step ID */
  outputs: Record<string, unknown>;
  /** Error if pipeline failed */
  error?: {
    name: string;
    message: string;
    stack?: string;
    stepId?: string;
  };
}

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
 * ], agentContext);
 *
 * const events: AgentEvent[] = [];
 * const result = await pipeline.run('AI trends', (event) => {
 *   events.push(event);
 *   console.log(event.type);
 * });
 * console.log('Pipeline completed:', result.success);
 * ```
 */
export class SequentialPipeline {
  private steps: WorkflowStep[];
  private executor: WorkflowExecutor;
  private agentContext: AgentContext;
  private continueOnFailure: boolean;
  private destroyed = false;

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
   * @param listener - Callback for each event emitted during execution
   * @returns Promise resolving to PipelineResult
   */
  async run(
    input: unknown,
    listener: (event: AgentEvent) => void
  ): Promise<PipelineResult> {
    const workflowId = `pipeline-${generateId()}`;
    const sessionId = this.agentContext.sessionId;
    const stepOutputs = new Map<string, unknown>();

    // Emit workflow.start event
    listener({
      type: 'workflow.start',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      workflowName: 'SequentialPipeline',
    });

    let currentInput = input;
    let error: { name: string; message: string; stack?: string; stepId?: string } | undefined;
    let allSucceeded = true;

    try {
      for (let index = 0; index < this.steps.length; index++) {
        if (this.destroyed) break;

        const step = this.steps[index]!;

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
          listener({
            type: 'workflow.step.end',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            stepId: step.id,
            result: 'skipped',
          });
          continue;
        }

        // Execute step
        try {
          const stepResult = await this.executor.executeStep(
            step,
            currentInput,
            workflowId,
            event => {
              // Capture output for next step
              if (event.type === 'agent.complete') {
                const output = (event as any).output;
                stepOutputs.set(step.id, output);
              }
              // Forward all events to caller
              listener(event);
            }
          );

          if (stepResult.result === 'failure') {
            allSucceeded = false;
            if (!this.continueOnFailure) {
              if (stepResult.error) {
                const e: { name: string; message: string; stack?: string; stepId?: string } = {
                  name: stepResult.error.name,
                  message: stepResult.error.message,
                  stepId: step.id,
                };
                if (stepResult.error.stack !== undefined) e.stack = stepResult.error.stack;
                error = e;
              } else {
                error = { name: 'StepError', message: `Step ${step.id} failed`, stepId: step.id };
              }

              // Emit workflow.error
              listener({
                type: 'workflow.error',
                timestamp: Date.now(),
                sessionId,
                workflowId,
                error: serializeError(error),
                stepId: step.id,
              });
              break;
            }
            // Continue on failure — emit error event but keep going
            listener({
              type: 'workflow.error',
              timestamp: Date.now(),
              sessionId,
              workflowId,
              error: stepResult.error ?? serializeError(new Error(`Step ${step.id} failed`)),
              stepId: step.id,
            });
          }

          // Update currentInput for next step
          const output = stepOutputs.get(step.id);
          if (output !== undefined) {
            currentInput = output;
          }
        } catch (err) {
          allSucceeded = false;
          if (!this.continueOnFailure) {
            error = {
              name: (err as Error).name,
              message: (err as Error).message,
              stepId: step.id,
            };

            listener({
              type: 'workflow.error',
              timestamp: Date.now(),
              sessionId,
              workflowId,
              error: serializeError(error),
              stepId: step.id,
            });
            break;
          }
        }
      }
    } catch (err) {
      error = {
        name: (err as Error).name,
        message: (err as Error).message,
      };
    }

    // Emit workflow.complete
    const outputs = Object.fromEntries(stepOutputs);
    listener({
      type: 'workflow.complete',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      result: outputs,
    });

    const result: PipelineResult = {
      success: allSucceeded || this.continueOnFailure,
      outputs,
    };
    if (error !== undefined) result.error = error;
    return result;
  }

  /**
   * Stop pipeline execution
   */
  stop(): void {
    this.destroyed = true;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.destroyed = true;
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
 * const events: AgentEvent[] = [];
 * const result = await pipeline.run('input', (event) => {
 *   events.push(event);
 * });
 * ```
 */
export class ParallelPipeline {
  private steps: WorkflowStep[];
  private executor: WorkflowExecutor;
  private agentContext: AgentContext;
  private maxConcurrency: number;
  private continueOnFailure: boolean;
  private destroyed = false;

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
   * @param listener - Callback for each event emitted during execution
   * @returns Promise resolving to PipelineResult
   */
  async run(
    input: unknown,
    listener: (event: AgentEvent) => void
  ): Promise<PipelineResult> {
    const workflowId = `pipeline-${generateId()}`;
    const sessionId = this.agentContext.sessionId;

    // Emit workflow.start event
    listener({
      type: 'workflow.start',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      workflowName: 'ParallelPipeline',
    });

    // Track step outputs
    const stepOutputs = new Map<string, unknown>();
    let allSucceeded = true;
    let firstError:
      | { name: string; message: string; stack?: string; stepId?: string }
      | undefined;

    /**
     * Execute a single step (used in parallel with concurrency limiting)
     */
    const executeOneStep = async (step: WorkflowStep): Promise<void> => {
      if (this.destroyed) return;

      // Check skip condition
      if (step.skip && step.skip(input)) {
        listener({
          type: 'workflow.step.end',
          timestamp: Date.now(),
          sessionId,
          workflowId,
          stepId: step.id,
          result: 'skipped',
        });
        return;
      }

      try {
        const stepResult = await this.executor.executeStep(
          step,
          input,
          workflowId,
          event => {
            // Capture output
            if (event.type === 'agent.complete') {
              const output = (event as any).output;
              stepOutputs.set(step.id, output);
            }
            // Forward all events to caller
            listener(event);
          }
        );

        if (stepResult.result === 'failure') {
          allSucceeded = false;
          if (!firstError) {
            if (stepResult.error) {
              const fe: { name: string; message: string; stack?: string; stepId?: string } = {
                name: stepResult.error.name,
                message: stepResult.error.message,
                stepId: step.id,
              };
              if (stepResult.error.stack !== undefined) fe.stack = stepResult.error.stack;
              firstError = fe;
            } else {
              firstError = { name: 'StepError', message: `Step ${step.id} failed`, stepId: step.id };
            }
          }

          if (!this.continueOnFailure) {
            throw new Error(`Step ${step.id} failed`);
          }

          // Emit error event but continue
          listener({
            type: 'workflow.error',
            timestamp: Date.now(),
            sessionId,
            workflowId,
            error: stepResult.error ?? serializeError(new Error(`Step ${step.id} failed`)),
            stepId: step.id,
          });
        }
      } catch (err) {
        allSucceeded = false;
        if (!firstError) {
          firstError = {
            name: (err as Error).name,
            message: (err as Error).message,
            stepId: step.id,
          };
        }

        if (!this.continueOnFailure) {
          throw err;
        }

        listener({
          type: 'workflow.error',
          timestamp: Date.now(),
          sessionId,
          workflowId,
          error: serializeError(err),
          stepId: step.id,
        });
      }
    };

    // Execute steps with concurrency limiting
    try {
      const tasks = this.steps.map(step => () => executeOneStep(step));
      await runWithConcurrencyLimit(tasks, this.maxConcurrency);
    } catch {
      // Errors already handled in executeOneStep
      // (only re-thrown for !continueOnFailure)
    }

    // Emit workflow.complete
    const outputs = Object.fromEntries(stepOutputs);
    listener({
      type: 'workflow.complete',
      timestamp: Date.now(),
      sessionId,
      workflowId,
      result: outputs,
    });

    const parResult: PipelineResult = {
      success: allSucceeded || this.continueOnFailure,
      outputs,
    };
    if (firstError !== undefined) parResult.error = firstError;
    return parResult;
  }

  /**
   * Stop pipeline execution
   */
  stop(): void {
    this.destroyed = true;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.destroyed = true;
  }
}

// ============================================================
// Concurrency Limiter
// ============================================================

/**
 * Run async tasks with a concurrency limit
 */
async function runWithConcurrencyLimit(
  tasks: Array<() => Promise<void>>,
  maxConcurrency: number
): Promise<void> {
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task().then(() => {
      const idx = executing.indexOf(p);
      if (idx !== -1) executing.splice(idx, 1);
    });
    executing.push(p);

    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
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
