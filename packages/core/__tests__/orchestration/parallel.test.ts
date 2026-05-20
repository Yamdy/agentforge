import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelExecutor } from '../../src/orchestration/executors/parallel.js';
import type { Agent, AgentRunResult } from '../../src/index.js';
import type { OrchestrationStepConfig } from '@primo-ai/sdk';

function createMockAgent(response: string, tokenUsage = { input: 10, output: 20 }, delay = 0): Agent {
  return {
    run: vi.fn(async (input: string, options?: { signal?: AbortSignal }): Promise<AgentRunResult> => {
      if (options?.signal?.aborted) throw new DOMException('Agent execution aborted', 'AbortError');
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      return { response, tokenUsage, sessionId: `session-${Date.now()}`, compatRetries: 0 };
    }),
    stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn(),
  } as unknown as Agent;
}

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor;
  let step: OrchestrationStepConfig;
  beforeEach(() => { executor = new ParallelExecutor(); step = { name: 'parallel-step', agents: [] }; });

  it('should execute agents in parallel', async () => {
    const agents = [createMockAgent('R1'), createMockAgent('R2'), createMockAgent('R3')];
    const results = await executor.execute(step, agents, 'test');
    expect(results).toHaveLength(3);
    expect(results.map(r => r.response)).toEqual(['R1', 'R2', 'R3']);
  });

  it('should fail-fast on error', async () => {
    const errorAgent = { run: vi.fn(async () => { throw new Error('Failed'); }), stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn() } as unknown as Agent;
    const executorFF = new ParallelExecutor({ failureStrategy: 'fail-fast' });
    await expect(executorFF.execute(step, [errorAgent], 'test')).rejects.toThrow('Failed');
  });

  it('should continue on error', async () => {
    const agent1 = createMockAgent('R1');
    const errorAgent = { run: vi.fn(async () => { throw new Error('Failed'); }), stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn() } as unknown as Agent;
    const executorCont = new ParallelExecutor({ failureStrategy: 'continue' });
    const results = await executorCont.execute(step, [agent1, errorAgent], 'test');
    expect(results[0].response).toBe('R1');
    expect(results[1].error).toBeInstanceOf(Error);
  });

  it('should respect maxConcurrency', async () => {
    const agents = [createMockAgent('R1', { input: 10, output: 20 }, 50), createMockAgent('R2', { input: 10, output: 20 }, 50), createMockAgent('R3', { input: 10, output: 20 }, 50), createMockAgent('R4', { input: 10, output: 20 }, 50)];
    const executorLim = new ParallelExecutor({ maxConcurrency: 2 });
    const start = Date.now();
    await executorLim.execute(step, agents, 'test');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(180);
  });

  it('should aggregate results', async () => {
    const results = [{ stepName: 'a', response: 'First', tokenUsage: { input: 1, output: 1 }, sessionId: 's1' }, { stepName: 'b', response: 'Second', tokenUsage: { input: 2, output: 2 }, sessionId: 's2' }];
    expect(await executor.aggregateResults(results as any)).toBe('First\n\n---\n\nSecond');
  });
});
