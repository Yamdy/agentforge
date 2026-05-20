import { describe, it, expect, vi } from 'vitest';
import { AgentRouter, executeRouter } from '../../src/orchestration/executors/router.js';
import type { Agent, AgentRunResult } from '../../src/index.js';
import type { RouterConfig, PipelineContext } from '@primo-ai/sdk';

function createMockAgent(response: string): Agent {
  return {
    run: vi.fn(async (input: string, options?: { signal?: AbortSignal }): Promise<AgentRunResult> => {
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return { response, tokenUsage: { input: 10, output: 20 }, sessionId: `s-${Date.now()}`, compatRetries: 0 };
    }),
    stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn(),
  } as unknown as Agent;
}
const createMockContext = (): PipelineContext => ({} as PipelineContext);

describe('AgentRouter', () => {
  it('should create router with agent instances', () => {
    const router = new AgentRouter({ routes: { code: createMockAgent('Code'), research: createMockAgent('Research') }, classifier: async () => 'code' });
    expect(router.getRouteKeys()).toEqual(['code', 'research']);
  });

  it('should throw when AgentConfig without factory', () => {
    expect(() => new AgentRouter({ routes: { code: { model: 'test' } }, classifier: async () => 'code' })).toThrow('no agentFactory');
  });

  it('should route to correct agent', async () => {
    const codeAgent = createMockAgent('Code');
    const researchAgent = createMockAgent('Research');
    const router = new AgentRouter({ routes: { code: codeAgent, research: researchAgent }, classifier: async (i) => i.includes('code') ? 'code' : 'research' });
    expect(await router.route('Write code', createMockContext())).toBe(codeAgent);
    expect(await router.route('Research', createMockContext())).toBe(researchAgent);
  });

  it('should fall back to default', async () => {
    const defaultAgent = createMockAgent('Default');
    const router = new AgentRouter({ routes: { code: createMockAgent('Code') }, default: defaultAgent, classifier: async () => 'unknown' });
    expect(await router.route('test', createMockContext())).toBe(defaultAgent);
  });

  it('should throw when no route', async () => {
    const router = new AgentRouter({ routes: { code: createMockAgent('Code') }, classifier: async () => 'unknown' });
    await expect(router.route('test', createMockContext())).rejects.toThrow('No route found');
  });
});

describe('executeRouter', () => {
  it('should execute routed agent', async () => {
    const agent = createMockAgent('Response');
    const router = new AgentRouter({ routes: { code: agent }, classifier: async () => 'code' });
    const result = await executeRouter(router, 'test', createMockContext());
    expect(result.response).toBe('Response');
  });

  it('should handle routing errors', async () => {
    const router = new AgentRouter({ routes: { code: createMockAgent('Code') }, classifier: async () => 'nonexistent' });
    const result = await executeRouter(router, 'test', createMockContext());
    expect(result.error).toBeInstanceOf(Error);
  });
});
