import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SequentialExecutor } from '../../src/orchestration/executors/sequential.js';
import type { Agent, AgentRunResult } from '../../src/index.js';
import type { OrchestrationStepConfig, OrchestrationStepResult } from '@primo-ai/sdk';

// Mock Agent
function createMockAgent(response: string, tokenUsage = { input: 10, output: 20 }): Agent {
  return {
    run: vi.fn(async (input: string): Promise<AgentRunResult> => ({
      response,
      tokenUsage,
      sessionId: `session-${Date.now()}`,
      compatRetries: 0,
    })),
    stream: vi.fn(),
    streamEvents: vi.fn(),
    use: vi.fn(),
    reset: vi.fn(),
  } as unknown as Agent;
}

describe('SequentialExecutor', () => {
  let executor: SequentialExecutor;

  beforeEach(() => {
    executor = new SequentialExecutor();
  });

  describe('execute', () => {
    it('should execute agents in sequence', async () => {
      const agent1 = createMockAgent('Response 1');
      const agent2 = createMockAgent('Response 2');

      const steps: OrchestrationStepConfig[] = [
        { name: 'step1', agent: { model: 'test' } },
        { name: 'step2', agent: { model: 'test' } },
      ];

      const agents = [agent1, agent2];
      const results = await executor.execute(steps, agents, 'test input');

      expect(results).toHaveLength(2);
      expect(results[0].stepName).toBe('step1');
      expect(results[0].response).toBe('Response 1');
      expect(results[1].stepName).toBe('step2');
      expect(results[1].response).toBe('Response 2');

      // Verify execution order
      expect(agent1.run).toHaveBeenCalledWith('test input', { signal: undefined });
      expect(agent2.run).toHaveBeenCalledWith('test input', { signal: undefined });
    });

    it('should pass output from previous step to next step when configured', async () => {
      const agent1 = createMockAgent('First output');
      const agent2 = createMockAgent('Second output');

      const steps: OrchestrationStepConfig[] = [
        { name: 'step1', agent: { model: 'test' } },
        { name: 'step2', agent: { model: 'test' } },
      ];

      const executorWithChaining = new SequentialExecutor({ chainOutput: true });
      const agents = [agent1, agent2];
      await executorWithChaining.execute(steps, agents, 'initial input');

      // First agent gets initial input
      expect(agent1.run).toHaveBeenCalledWith('initial input', { signal: undefined });
      // Second agent gets first agent's output
      expect(agent2.run).toHaveBeenCalledWith('First output', { signal: undefined });
    });

    it('should aggregate token usage across steps', async () => {
      const agent1 = createMockAgent('Response 1', { input: 100, output: 50 });
      const agent2 = createMockAgent('Response 2', { input: 200, output: 100 });

      const steps: OrchestrationStepConfig[] = [
        { name: 'step1', agent: { model: 'test' } },
        { name: 'step2', agent: { model: 'test' } },
      ];

      const agents = [agent1, agent2];
      const results = await executor.execute(steps, agents, 'test');

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

    it('should stop on first error with fail-fast strategy', async () => {
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

      const steps: OrchestrationStepConfig[] = [
        { name: 'step1', agent: { model: 'test' } },
        { name: 'step2', agent: { model: 'test' } },
        { name: 'step3', agent: { model: 'test' } },
      ];

      const executorFailFast = new SequentialExecutor({
        failureStrategy: 'fail-fast',
      });
      const agents = [agent1, errorAgent, agent3];

      await expect(executorFailFast.execute(steps, agents, 'test')).rejects.toThrow('Agent failed');

      // Third agent should not be called
      expect(agent3.run).not.toHaveBeenCalled();
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

      const steps: OrchestrationStepConfig[] = [
        { name: 'step1', agent: { model: 'test' } },
        { name: 'step2', agent: { model: 'test' } },
        { name: 'step3', agent: { model: 'test' } },
      ];

      const executorContinue = new SequentialExecutor({
        failureStrategy: 'continue',
      });
      const agents = [agent1, errorAgent, agent3];

      const results = await executorContinue.execute(steps, agents, 'test');

      expect(results).toHaveLength(3);
      expect(results[0].response).toBe('Response 1');
      expect(results[1].error).toBeInstanceOf(Error);
      expect(results[1].error?.message).toBe('Agent failed');
      expect(results[2].response).toBe('Response 3');
    });

    it('should respect abort signal', async () => {
      const agent1 = createMockAgent('Response 1');
      const controller = new AbortController();

      const steps: OrchestrationStepConfig[] = [
        { name: 'step1', agent: { model: 'test' } },
        { name: 'step2', agent: { model: 'test' } },
      ];

      // Abort before execution
      controller.abort();

      const agents = [agent1, createMockAgent('Response 2')];
      await expect(executor.execute(steps, agents, 'test', { signal: controller.signal })).rejects.toThrow();
    });
  });
});
