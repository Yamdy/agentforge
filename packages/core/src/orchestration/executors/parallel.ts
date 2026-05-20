import type {
  OrchestrationStepConfig,
  OrchestrationStepResult,
  OrchestrationStepOptions,
} from '@primo-ai/sdk';
import type { Agent } from '../../agent.js';

export class ParallelExecutor {
  private readonly options?: OrchestrationStepOptions;

  constructor(options?: OrchestrationStepOptions) {
    this.options = options;
  }

  async execute(
    step: OrchestrationStepConfig,
    agents: Agent[],
    input: string,
    options?: { signal?: AbortSignal }
  ): Promise<OrchestrationStepResult[]> {
    const maxConcurrency = this.options?.maxConcurrency ?? agents.length;
    const failureStrategy = this.options?.failureStrategy ?? 'fail-fast';
    const results: OrchestrationStepResult[] = [];
    const batches = this.createBatches(agents, maxConcurrency);

    for (const batch of batches) {
      if (options?.signal?.aborted) {
        throw new DOMException('Parallel execution aborted', 'AbortError');
      }
      const batchResults = await this.executeBatch(batch, input, options?.signal, failureStrategy);
      results.push(...batchResults);
      if (failureStrategy === 'fail-fast') {
        const errorResult = results.find((r) => r.error);
        if (errorResult?.error) throw errorResult.error;
      }
    }
    return results;
  }

  private createBatches(agents: Agent[], maxConcurrency: number): Agent[][] {
    if (maxConcurrency >= agents.length) return [agents];
    const batches: Agent[][] = [];
    for (let i = 0; i < agents.length; i += maxConcurrency) {
      batches.push(agents.slice(i, i + maxConcurrency));
    }
    return batches;
  }

  private async executeBatch(
    agents: Agent[], input: string, signal: AbortSignal | undefined,
    failureStrategy: 'fail-fast' | 'continue'
  ): Promise<OrchestrationStepResult[]> {
    const promises = agents.map(async (agent, index) => {
      try {
        const result = await agent.run(input, { signal });
        return { stepName: `agent-${index}`, response: result.response, tokenUsage: result.tokenUsage, sessionId: result.sessionId };
      } catch (error) {
        if (failureStrategy === 'fail-fast') throw error;
        return { stepName: `agent-${index}`, response: '', tokenUsage: { input: 0, output: 0 }, sessionId: '', error: error instanceof Error ? error : new Error(String(error)) };
      }
    });
    if (failureStrategy === 'fail-fast') return Promise.all(promises);
    const settled = await Promise.allSettled(promises);
    return settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      return { stepName: `agent-${index}`, response: '', tokenUsage: { input: 0, output: 0 }, sessionId: '', error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)) };
    });
  }

  async aggregateResults(results: OrchestrationStepResult[]): Promise<string> {
    const aggregator = this.options?.aggregator;
    if (aggregator) return await aggregator(results);
    return results.filter((r) => !r.error).map((r) => r.response).join('\n\n---\n\n');
  }
}
