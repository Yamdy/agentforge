import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestrationPipeline, createPipeline } from '../../src/orchestration/pipeline.js';
import { AgentRouter } from '../../src/orchestration/executors/router.js';
import type { Agent, AgentRunResult } from '../../src/index.js';
import type { PipelineContext } from '@primo-ai/sdk';

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
        options?: unknown
      ): Promise<AgentRunResult> => {
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

describe('OrchestrationPipeline', () => {
  describe('step', () => {
    it('should add sequential step with single agent', () => {
      const agent = createMockAgent('Response');
      const pipeline = new OrchestrationPipeline().step('step1', agent);

      expect(pipeline.getStepCount()).toBe(1);
      expect(pipeline.getStepNames()).toEqual(['step1']);
    });

    it('should add parallel step with agent array', () => {
      const agent1 = createMockAgent('Response 1');
      const agent2 = createMockAgent('Response 2');
      const pipeline = new OrchestrationPipeline().step('parallel', [agent1, agent2]);

      expect(pipeline.getStepCount()).toBe(1);
      expect(pipeline.getStepNames()).toEqual(['parallel']);
    });

    it('should add router step', () => {
      const agent = createMockAgent('Response');
      const router = new AgentRouter({
        routes: { code: agent },
        classifier: async () => 'code',
      });
      const pipeline = new OrchestrationPipeline().step('router', router);

      expect(pipeline.getStepCount()).toBe(1);
      expect(pipeline.getStepNames()).toEqual(['router']);
    });

    it('should support method chaining', () => {
      const agent1 = createMockAgent('Response 1');
      const agent2 = createMockAgent('Response 2');
      const pipeline = new OrchestrationPipeline()
        .step('step1', agent1)
        .step('step2', agent2);

      expect(pipeline.getStepCount()).toBe(2);
      expect(pipeline.getStepNames()).toEqual(['step1', 'step2']);
    });
  });

  describe('run', () => {
    it('should execute sequential steps in order', async () => {
      const agent1 = createMockAgent('First');
      const agent2 = createMockAgent('Second');
      const pipeline = new OrchestrationPipeline()
        .step('step1', agent1)
        .step('step2', agent2);

      const result = await pipeline.run('input');

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].response).toBe('First');
      expect(result.steps[1].response).toBe('Second');
      expect(result.response).toBe('Second');
    });

    it('should chain output between steps', async () => {
      const agent1 = createMockAgent('First output');
      const agent2 = createMockAgent('Second output');
      const pipeline = new OrchestrationPipeline()
        .step('step1', agent1)
        .step('step2', agent2);

      await pipeline.run('initial input');

      // First agent gets initial input
      expect(agent1.run).toHaveBeenCalledWith('initial input', { signal: undefined });
      // Second agent gets first agent's output (chained)
      expect(agent2.run).toHaveBeenCalledWith('First output', { signal: undefined });
    });

    it('should execute parallel steps concurrently', async () => {
      const agent1 = createMockAgent('Response 1', { input: 10, output: 20 }, 50);
      const agent2 = createMockAgent('Response 2', { input: 20, output: 40 }, 50);
      const pipeline = new OrchestrationPipeline().step('parallel', [agent1, agent2]);

      const startTime = Date.now();
      const result = await pipeline.run('input');
      const duration = Date.now() - startTime;

      expect(result.steps).toHaveLength(1);
      // Parallel execution should be faster than sequential
      expect(duration).toBeLessThan(300);
      // Token usage should be aggregated
      expect(result.steps[0].tokenUsage).toEqual({ input: 30, output: 60 });
    });

    it('should execute router step and route to correct agent', async () => {
      const codeAgent = createMockAgent('Code response');
      const researchAgent = createMockAgent('Research response');
      const router = new AgentRouter({
        routes: {
          code: codeAgent,
          research: researchAgent,
        },
        classifier: async (input) => (input.includes('code') ? 'code' : 'research'),
      });
      const pipeline = new OrchestrationPipeline().step('classify', router);

      const result = await pipeline.run('Write some code');

      expect(result.steps[0].response).toBe('Code response');
      expect(codeAgent.run).toHaveBeenCalled();
      expect(researchAgent.run).not.toHaveBeenCalled();
    });

    it('should aggregate token usage across all steps', async () => {
      const agent1 = createMockAgent('First', { input: 100, output: 50 });
      const agent2 = createMockAgent('Second', { input: 200, output: 100 });
      const pipeline = new OrchestrationPipeline()
        .step('step1', agent1)
        .step('step2', agent2);

      const result = await pipeline.run('input');

      expect(result.totalTokenUsage).toEqual({ input: 300, output: 150 });
    });

    it('should generate session ID if not provided', async () => {
      const agent = createMockAgent('Response');
      const pipeline = new OrchestrationPipeline().step('step1', agent);

      const result = await pipeline.run('input');

      expect(result.sessionId).toMatch(/^orchestration-\d+$/);
    });

    it('should use provided session ID', async () => {
      const agent = createMockAgent('Response');
      const pipeline = new OrchestrationPipeline().step('step1', agent);

      const result = await pipeline.run('input', { sessionId: 'custom-session' });

      expect(result.sessionId).toBe('custom-session');
    });

    it('should handle errors with fail-fast strategy', async () => {
      const agent1 = createMockAgent('First');
      const errorAgent = {
        run: vi.fn(async () => {
          throw new Error('Agent failed');
        }),
        stream: vi.fn(),
        streamEvents: vi.fn(),
        use: vi.fn(),
        reset: vi.fn(),
      } as unknown as Agent;
      const agent3 = createMockAgent('Third');

      const pipeline = new OrchestrationPipeline()
        .step('step1', agent1)
        .step('step2', errorAgent, { failureStrategy: 'fail-fast' })
        .step('step3', agent3);

      await expect(pipeline.run('input')).rejects.toThrow('Agent failed');
      // Third agent should not be called
      expect(agent3.run).not.toHaveBeenCalled();
    });

    it('should continue on error with continue strategy', async () => {
      const agent1 = createMockAgent('First');
      const errorAgent = {
        run: vi.fn(async () => {
          throw new Error('Agent failed');
        }),
        stream: vi.fn(),
        streamEvents: vi.fn(),
        use: vi.fn(),
        reset: vi.fn(),
      } as unknown as Agent;
      const agent3 = createMockAgent('Third');

      const pipeline = new OrchestrationPipeline()
        .step('step1', agent1)
        .step('step2', errorAgent, { failureStrategy: 'continue' })
        .step('step3', agent3);

      const result = await pipeline.run('input');

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].response).toBe('First');
      expect(result.steps[1].error).toBeInstanceOf(Error);
      expect(result.steps[2].response).toBe('Third');
    });

    it('should respect abort signal', async () => {
      const agent = createMockAgent('Response');
      const pipeline = new OrchestrationPipeline().step('step1', agent);
      const controller = new AbortController();
      controller.abort();

      await expect(pipeline.run('input', { signal: controller.signal })).rejects.toThrow();
    });
  });

  describe('createPipeline', () => {
    it('should create a new pipeline', () => {
      const pipeline = createPipeline();
      expect(pipeline).toBeInstanceOf(OrchestrationPipeline);
    });

    it('should pass options to pipeline constructor', () => {
      const factory = vi.fn();
      const pipeline = createPipeline({ agentFactory: factory });
      expect(pipeline).toBeInstanceOf(OrchestrationPipeline);
    });
  });

  describe('mixed orchestration', () => {
    it('should support mixed sequential, parallel, and router steps', async () => {
      const plannerAgent = createMockAgent('Plan: Research X');
      const researcher1 = createMockAgent('Research result 1', { input: 50, output: 30 });
      const researcher2 = createMockAgent('Research result 2', { input: 60, output: 40 });
      const summarizerAgent = createMockAgent('Summary: ...');

      const pipeline = new OrchestrationPipeline()
        .step('plan', plannerAgent)
        .step('research', [researcher1, researcher2])
        .step('summarize', summarizerAgent);

      const result = await pipeline.run('Research topic X');

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].stepName).toBe('plan');
      expect(result.steps[1].stepName).toBe('research');
      expect(result.steps[2].stepName).toBe('summarize');

      // Verify chaining: researcher gets planner output
      expect(researcher1.run).toHaveBeenCalledWith('Plan: Research X', { signal: undefined });
      // Summarizer gets research results
      expect(summarizerAgent.run).toHaveBeenCalled();
    });
  });
});
