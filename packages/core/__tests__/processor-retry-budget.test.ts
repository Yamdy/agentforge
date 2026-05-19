import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { StageName } from '@primo-ai/sdk';

describe('Processor retryFrom budget', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Response from ${modelId}` }),
    );
  });

  it('stops the loop when a processor retryFrom exceeds the budget', async () => {
    let retryCount = 0;
    const maxIterations = 50; // high limit — should NOT reach this

    const agent = new Agent({ model: 'mock/test', maxIterations });
    agent.use({
      stage: 'processStepOutput',
      execute: async (pCtx) => {
        retryCount++;
        // Always retry — simulates a processor that never resolves
        pCtx.control.abort('Always retry', 'processStepOutput' as StageName);
      },
    });

    // Should terminate well before maxIterations
    await expect(agent.run('trigger retry loop')).rejects.toThrow();
    // The default budget (3) should limit retries
    expect(retryCount).toBeLessThanOrEqual(5);
  });

  it('allows legitimate retries within the budget', async () => {
    let retryCount = 0;
    const agent = new Agent({ model: 'mock/test', maxIterations: 10 });
    agent.use({
      stage: 'processStepOutput',
      execute: async (pCtx) => {
        retryCount++;
        if (retryCount <= 2) {
          pCtx.control.abort('Temporary issue', 'processStepOutput' as StageName);
        }
        // Otherwise continue normally
      },
    });

    // 2 retries should be within budget, agent should complete
    const result = await agent.run('legitimate retry');
    expect(result.response).toBeDefined();
    expect(retryCount).toBeGreaterThanOrEqual(3);
  });

  it('emits an event when processor retry budget is exhausted', async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const agent = new Agent({ model: 'mock/test', maxIterations: 50 });
    agent.use({
      stage: 'processStepOutput',
      execute: async (pCtx) => {
        pCtx.control.abort('stuck', 'invokeLLM' as StageName);
      },
    });
    agent.eventBus.subscribe('processor:retry_exhausted', (data: unknown) => {
      events.push({ type: 'processor:retry_exhausted', payload: data });
    });

    await expect(agent.run('trigger')).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect((events[0].payload as Record<string, unknown>).stage).toBe('invokeLLM');
  });
});
