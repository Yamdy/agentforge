import type { OrchestrationStepConfig, OrchestrationStepResult, OrchestrationStepOptions } from '@primo-ai/sdk';
import type { Agent } from '../../agent.js';

export interface SequentialExecutorOptions extends OrchestrationStepOptions {
  /** When true, pass output from previous step as input to next step */
  chainOutput?: boolean;
}

/**
 * Sequential executor runs agents one after another.
 * Supports optional output chaining and failure strategies.
 */
export class SequentialExecutor {
  private readonly chainOutput: boolean;
  private readonly failureStrategy: 'fail-fast' | 'continue';

  constructor(options?: SequentialExecutorOptions) {
    this.chainOutput = options?.chainOutput ?? false;
    this.failureStrategy = options?.failureStrategy ?? 'fail-fast';
  }

  /**
   * Execute agents sequentially.
   * @param steps Step configurations
   * @param agents Agent instances (must match steps length)
   * @param input Initial input
   * @param options Execution options
   */
  async execute(
    steps: OrchestrationStepConfig[],
    agents: Agent[],
    input: string,
    options?: { signal?: AbortSignal }
  ): Promise<OrchestrationStepResult[]> {
    const results: OrchestrationStepResult[] = [];
    let currentInput = input;

    for (let i = 0; i < steps.length; i++) {
      // Check abort signal before each step
      if (options?.signal?.aborted) {
        throw new DOMException('Sequential execution aborted', 'AbortError');
      }

      const step = steps[i];
      const agent = agents[i];

      if (!step || !agent) {
        throw new Error(`Invalid step or agent at index ${i}`);
      }

      try {
        const runResult = await agent.run(currentInput, {
          signal: options?.signal,
        });

        const result: OrchestrationStepResult = {
          stepName: step.name,
          response: runResult.response,
          tokenUsage: runResult.tokenUsage,
          sessionId: runResult.sessionId,
        };

        results.push(result);

        // Chain output if configured
        if (this.chainOutput) {
          currentInput = runResult.response;
        }
      } catch (error) {
        if (this.failureStrategy === 'fail-fast') {
          throw error;
        }

        // Continue strategy: record error and continue
        const result: OrchestrationStepResult = {
          stepName: step.name,
          response: '',
          tokenUsage: { input: 0, output: 0 },
          sessionId: '',
          error: error instanceof Error ? error : new Error(String(error)),
        };

        results.push(result);
      }
    }

    return results;
  }
}
