import { describe, it, expect, vi } from 'vitest';
import { OrchestrationPipeline, createPipeline } from '../../src/orchestration/pipeline.js';
import { AgentRouter } from '../../src/orchestration/executors/router.js';
import type { Agent, AgentRunResult } from '../../src/index.js';

function createMockAgent(response: string, tokenUsage = { input: 10, output: 20 }, delay = 0): Agent {
  return {
    run: vi.fn(async (input: string, options?: unknown): Promise<AgentRunResult> => {
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      return { response, tokenUsage, sessionId: `s-${Date.now()}`, compatRetries: 0 };
    }),
    stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn(),
  } as unknown as Agent;
}

describe('OrchestrationPipeline', () => {
  it('should add sequential step', () => {
    const p = new OrchestrationPipeline().step('s1', createMockAgent('R'));
    expect(p.getStepCount()).toBe(1);
    expect(p.getStepNames()).toEqual(['s1']);
  });

  it('should add parallel step', () => {
    const p = new OrchestrationPipeline().step('par', [createMockAgent('R1'), createMockAgent('R2')]);
    expect(p.getStepCount()).toBe(1);
  });

  it('should add router step', () => {
    const router = new AgentRouter({ routes: { code: createMockAgent('R') }, classifier: async () => 'code' });
    const p = new OrchestrationPipeline().step('route', router);
    expect(p.getStepCount()).toBe(1);
  });

  it('should execute sequential steps', async () => {
    const a1 = createMockAgent('First');
    const a2 = createMockAgent('Second');
    const result = await new OrchestrationPipeline().step('s1', a1).step('s2', a2).run('input');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].response).toBe('First');
    expect(result.steps[1].response).toBe('Second');
  });

  it('should chain output between steps', async () => {
    const a1 = createMockAgent('First output');
    const a2 = createMockAgent('Second output');
    await new OrchestrationPipeline().step('s1', a1).step('s2', a2).run('initial');
    expect(a1.run).toHaveBeenCalledWith('initial', { signal: undefined });
    expect(a2.run).toHaveBeenCalledWith('First output', { signal: undefined });
  });

  it('should execute parallel concurrently', async () => {
    const a1 = createMockAgent('R1', { input: 10, output: 20 }, 50);
    const a2 = createMockAgent('R2', { input: 20, output: 40 }, 50);
    const start = Date.now();
    const result = await new OrchestrationPipeline().step('par', [a1, a2]).run('input');
    expect(Date.now() - start).toBeLessThan(100);
    expect(result.steps[0].tokenUsage).toEqual({ input: 30, output: 60 });
  });

  it('should execute router step', async () => {
    const codeAgent = createMockAgent('Code response');
    const router = new AgentRouter({ routes: { code: codeAgent }, classifier: async (i) => i.includes('code') ? 'code' : 'other' });
    const result = await new OrchestrationPipeline().step('route', router).run('Write code');
    expect(result.steps[0].response).toBe('Code response');
  });

  it('should aggregate token usage', async () => {
    const result = await new OrchestrationPipeline().step('s1', createMockAgent('R', { input: 100, output: 50 })).step('s2', createMockAgent('R', { input: 200, output: 100 })).run('input');
    expect(result.totalTokenUsage).toEqual({ input: 300, output: 150 });
  });

  it('should generate session ID', async () => {
    const result = await new OrchestrationPipeline().step('s1', createMockAgent('R')).run('input');
    expect(result.sessionId).toMatch(/^orchestration-\d+$/);
  });

  it('should use provided session ID', async () => {
    const result = await new OrchestrationPipeline().step('s1', createMockAgent('R')).run('input', { sessionId: 'custom' });
    expect(result.sessionId).toBe('custom');
  });

  it('should fail-fast on error', async () => {
    const errorAgent = { run: vi.fn(async () => { throw new Error('Failed'); }), stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn() } as unknown as Agent;
    const a3 = createMockAgent('Third');
    await expect(new OrchestrationPipeline().step('s1', createMockAgent('R')).step('s2', errorAgent, { failureStrategy: 'fail-fast' }).step('s3', a3).run('input')).rejects.toThrow('Failed');
    expect(a3.run).not.toHaveBeenCalled();
  });

  it('should continue on error', async () => {
    const errorAgent = { run: vi.fn(async () => { throw new Error('Failed'); }), stream: vi.fn(), streamEvents: vi.fn(), use: vi.fn(), reset: vi.fn() } as unknown as Agent;
    const result = await new OrchestrationPipeline().step('s1', createMockAgent('First')).step('s2', errorAgent, { failureStrategy: 'continue' }).step('s3', createMockAgent('Third')).run('input');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1].error).toBeInstanceOf(Error);
    expect(result.steps[2].response).toBe('Third');
  });

  it('should respect abort signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(new OrchestrationPipeline().step('s1', createMockAgent('R')).run('input', { signal: ctrl.signal })).rejects.toThrow();
  });

  it('createPipeline should work', () => {
    expect(createPipeline()).toBeInstanceOf(OrchestrationPipeline);
  });

  it('should support mixed steps', async () => {
    const planner = createMockAgent('Plan');
    const r1 = createMockAgent('R1', { input: 50, output: 30 });
    const r2 = createMockAgent('R2', { input: 60, output: 40 });
    const summarizer = createMockAgent('Summary');
    const result = await new OrchestrationPipeline().step('plan', planner).step('research', [r1, r2]).step('summarize', summarizer).run('Research X');
    expect(result.steps).toHaveLength(3);
    expect(r1.run).toHaveBeenCalledWith('Plan', { signal: undefined });
  });
});
