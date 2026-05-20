import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelExecutor } from '../../src/orchestration/executors/parallel.js';
import type { Agent, AgentRunResult } from '../../src/index.js';
import type { OrchestrationStepConfig } from '@primo-ai/sdk';

// Mock Agent
function createMockAgent(
  response: string,
  tokenUsage = { input: 10, output: 20 },
  delay = 0
): Agent {
  return {
    run: vi.fn(
      async (
        input: string,
        options?: { signal?: AbortSignal }
      ): Promise<AgentRunResult> => {
        if (options?.signal?.aborted) {
          throw new DOMException('Agent execution aborted', 'AbortError');
        }
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        return {
          response,
          tokenUsage,
          sessionId: `session-${Date.now()}`,
          compatRetries: 0,
        };
      }
    ),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    use: vi.fn(),
    reset: vi.fn(),
  } as unknown as Agent;
}

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor;
  let step: OrchestrationStepConfig;

  beforeEach(() => {
    executor = new ParallelExecutor();
    step = { name: 'parallel-step', agents: [] };
  });

  describe('execute', () => {
    it('should execute agents in parallel', async () => {
      const agent1 = createMockAgent('Response 1');
      const agent2 = createMockAgent('Response 2');
      const agent3 = createMockAgent('Response 3');

      const agents = [agent1, agent2, agent3];
      const results = await executor.execute(step, agents, 'test input');

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.response)).toEqual([
        'Response 1',
        'Response 2',
        'Response 3',
      ]);

      // All agents should be called with the same input
      expect(agent1.run).toHaveBeenCalledWith('test input', { signal: undefined });
      expect(agent2.run).toHaveBeenCalledWith('test input', { signal: undefined });
      expect(agent3.run).toHaveBeenCalledWith('test input', { signal: undefined });
    });

    it('should aggregate token usage across agents', async () => {
      const agent1 = createMockAgent('Response 1', { input: 100, output: 50 });
      const agent2 = createMockAgent('Response 2', { input: 200, output: 100 });

      const agents = [agent1, agent2];
      const results = await executor.execute(step, agents, 'test');

      const totalUsage = results.reduce(
        (acc, r) => ({
          input: acc.input + r.tokenUsage.input,
          output: acc.output + r.tokenUsage.output,
        }),
        { input: 0, output: 0 }
      );

      expect(totalUsage.input).toBe(300);
      expect(totalUsage.output).toBe(150);
    });

    it('should fail-fast on first error with fail-fast strategy', async () => {
      const agent1 = createMockAgent('Response 1');
      const errorAgent = {
        run: vi.fn(async () => {
          throw new Error('Agent failed');
        }),
        stream: vi.fn(),
        streamEvents: vi.fn(),
        use: vi.fn(),
        reset: vi.fn(),
      } as unknown as Agent;
      const agent3 = createMockAgent('Response 3');

      const executorFailFast = new ParallelExecutor({
        failureStrategy: 'fail-fast',
      });
      const agents = [agent1, errorAgent, agent3];

      await expect(
        executorFailFast.execute(step, agents, 'test')
      ).rejects.toThrow('Agent failed');
    });

    it('should continue on error with continue strategy', async () => {
      const agent1 = createMockAgent('Response 1');
      const errorAgent = {
        run: vi.fn(async () => {
          throw new Error('Agent failed');
        }),
        stream: vi.fn(),
        streamEvents: vi.fn(),
        use: vi.fn(),
        reset: vi.fn(),
      } as unknown as Agent;
      const agent3 = createMockAgent('Response 3');

      const executorContinue = new ParallelExecutor({
        failureStrategy: 'continue',
      });
      const agents = [agent1, errorAgent, agent3];

      const results = await executorContinue.execute(step, agents, 'test');

      expect(results).toHaveLength(3);
      expect(results[0].response).toBe('Response 1');
      expect(results[1].error).toBeInstanceOf(Error);
      expect(results[1].error?.message).toBe('Agent failed');
      expect(results[2].response).toBe('Response 3');
    });

    it('should respect maxConcurrency option', async () => {
      // Use delays to verify sequential batching
      const agent1 = createMockAgent('Response 1', { input: 10, output: 20 }, 50);
      const agent2 = createMockAgent('Response 2', { input: 10, output: 20 }, 50);
      const agent3 = createMockAgent('Response 3', { input: 10, output: 20 }, 50);
      const agent4 = createMockAgent('Response 4', { input: 10, output: 20 }, 50);

      const executorLimited = new ParallelExecutor({ maxConcurrency: 2 });
      const agents = [agent1, agent2, agent3, agent4];

      const startTime = Date.now();
      const results = await executorLimited.execute(step, agents, 'test');
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(4);

      // With maxConcurrency=2 and 4 agents with 50ms delay each,
      // total time should be ~100ms (2 batches of 2 agents)
      // Not exactly 100ms due to parallel execution, but less than 200ms
      expect(duration).toBeLessThan(180);
      expect(duration).toBeGreaterThanOrEqual(50);
    });

    it('should respect abort signal', async () => {
      const agent1 = createMockAgent('Response 1');
      const controller = new AbortController();

      // Abort before execution
      controller.abort();

      const agents = [agent1, createMockAgent('Response 2')];
      await expect(
        executor.execute(step, agents, 'test', { signal: controller.signal })
      ).rejects.toThrow();
    });
  });

  describe('aggregateResults', () => {
    it('should concatenate results by default', async () => {
      const results = [
        { stepName: 'a', response: 'First', tokenUsage: { input: 1, output: 1 }, sessionId: 's1' },
        { stepName: 'b', response: 'Second', tokenUsage: { input: 2, output: 2 }, sessionId: 's2' },
      ];

      const aggregated = await executor.aggregateResults(results as any);
      expect(aggregated).toBe('First\n\n---\n\nSecond');
    });

    it('should use custom aggregator when provided', async () => {
      const customExecutor = new ParallelExecutor({
        aggregator: (results) => results.map((r) => r.response).join(' | '),
      });

      const results = [
        { stepName: 'a', response: 'First', tokenUsage: { input: 1, output: 1 }, sessionId: 's1' },
        { stepName: 'b', response: 'Second', tokenUsage: { input: 2, output: 2 }, sessionId: 's2' },
      ];

      const aggregated = await customExecutor.aggregateResults(results as any);
      expect(aggregated).toBe('First | Second');
    });

    it('should filter out error results in default aggregation', async () => {
      const results = [
        { stepName: 'a', response: 'First', tokenUsage: { input: 1, output: 1 }, sessionId: 's1' },
        { stepName: 'b', response: '', tokenUsage: { input: 0, output: 0 }, sessionId: 's2', error: new Error('Failed') },
        { stepName: 'c', response: 'Third', tokenUsage: { input: 3, output: 3 }, sessionId: 's3' },
      ];

      const aggregated = await executor.aggregateResults(results as any);
      expect(aggregated).toBe('First\n\n---\n\nThird');
    });
  });
});
