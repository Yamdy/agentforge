import { describe, it, expect, vi } from 'vitest';
import { FallbackRunner } from '../src/fallback-runner.js';
import type { FallbackInvoker } from '../src/fallback-runner.js';
import { EventBus } from '../src/event-bus.js';

function createMockInvoker(
  fn: () => Promise<{ response: string; tokenUsage: { input: number; output: number } }>,
): FallbackInvoker {
  return { invoke: vi.fn(fn) };
}

describe('FallbackRunner', () => {
  it('uses first model (lowest priority number)', async () => {
    const invokers = new Map<string, FallbackInvoker>();
    invokers.set(
      'model-a',
      createMockInvoker(async () => ({
        response: 'response from a',
        tokenUsage: { input: 5, output: 10 },
      })),
    );
    invokers.set(
      'model-b',
      createMockInvoker(async () => ({
        response: 'response from b',
        tokenUsage: { input: 3, output: 6 },
      })),
    );

    const factory = (model: string) => {
      const inv = invokers.get(model);
      if (!inv) throw new Error(`No mock for ${model}`);
      return inv;
    };

    const runner = new FallbackRunner({
      entries: [
        { model: 'model-a', priority: 0 },
        { model: 'model-b', priority: 1 },
      ],
      invokerFactory: factory,
    });

    const result = await runner.run({ prompt: 'test' });
    expect(result.response).toBe('response from a');
    expect(invokers.get('model-a')!.invoke).toHaveBeenCalledOnce();
    expect(invokers.get('model-b')!.invoke).not.toHaveBeenCalled();
  });

  it('falls back to next model on failure', async () => {
    const invokers = new Map<string, FallbackInvoker>();
    invokers.set(
      'bad-model',
      createMockInvoker(async () => {
        throw new Error('Model failed');
      }),
    );
    invokers.set(
      'good-model',
      createMockInvoker(async () => ({
        response: 'fallback response',
        tokenUsage: { input: 2, output: 4 },
      })),
    );

    const factory = (model: string) => {
      const inv = invokers.get(model);
      if (!inv) throw new Error(`No mock for ${model}`);
      return inv;
    };

    const runner = new FallbackRunner({
      entries: [
        { model: 'bad-model', priority: 0 },
        { model: 'good-model', priority: 1 },
      ],
      invokerFactory: factory,
    });

    const result = await runner.run({ prompt: 'test' });
    expect(result.response).toBe('fallback response');
    expect(invokers.get('bad-model')!.invoke).toHaveBeenCalledOnce();
    expect(invokers.get('good-model')!.invoke).toHaveBeenCalledOnce();
  });

  it('throws last error when all models fail', async () => {
    const invokers = new Map<string, FallbackInvoker>();
    invokers.set(
      'fail-a',
      createMockInvoker(async () => {
        throw new Error('fail A');
      }),
    );
    invokers.set(
      'fail-b',
      createMockInvoker(async () => {
        throw new Error('fail B');
      }),
    );

    const factory = (model: string) => {
      const inv = invokers.get(model);
      if (!inv) throw new Error(`No mock for ${model}`);
      return inv;
    };

    const runner = new FallbackRunner({
      entries: [
        { model: 'fail-a', priority: 0 },
        { model: 'fail-b', priority: 1 },
      ],
      invokerFactory: factory,
    });

    await expect(runner.run({ prompt: 'test' })).rejects.toThrow('fail B');
  });

  it('single entry behaves like direct call', async () => {
    const invoker = createMockInvoker(async () => ({
      response: 'direct',
      tokenUsage: { input: 1, output: 1 },
    }));

    const runner = new FallbackRunner({
      entries: [{ model: 'only-model', priority: 0 }],
      invokerFactory: () => invoker,
    });

    const result = await runner.run({ prompt: 'hello' });
    expect(result.response).toBe('direct');
    expect(invoker.invoke).toHaveBeenCalledOnce();
  });

  it('emits fallback event via EventBus when falling back', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('task:fallback', (data) =>
      events.push({ type: 'task:fallback', data }),
    );

    const invokers = new Map<string, FallbackInvoker>();
    invokers.set(
      'fail-model',
      createMockInvoker(async () => {
        throw new Error('fail');
      }),
    );
    invokers.set(
      'ok-model',
      createMockInvoker(async () => ({
        response: 'ok',
        tokenUsage: { input: 1, output: 1 },
      })),
    );

    const factory = (model: string) => {
      const inv = invokers.get(model);
      if (!inv) throw new Error(`No mock for ${model}`);
      return inv;
    };

    const runner = new FallbackRunner({
      entries: [
        { model: 'fail-model', priority: 0 },
        { model: 'ok-model', priority: 1 },
      ],
      invokerFactory: factory,
      eventBus,
    });

    await runner.run({ prompt: 'test' });
    expect(events).toHaveLength(1);
    expect(events[0].data).toEqual({
      from: 'fail-model',
      to: 'ok-model',
      error: expect.any(Error),
      latencyMs: expect.any(Number),
    });
  });

  it('includes latencyMs in fallback event', async () => {
    const eventBus = new EventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    eventBus.subscribe('task:fallback', (data) =>
      events.push({ type: 'task:fallback', data }),
    );

    const invokers = new Map<string, FallbackInvoker>();
    invokers.set(
      'slow-fail',
      createMockInvoker(async () => {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('timeout');
      }),
    );
    invokers.set(
      'ok-model',
      createMockInvoker(async () => ({
        response: 'ok',
        tokenUsage: { input: 1, output: 1 },
      })),
    );

    const factory = (model: string) => {
      const inv = invokers.get(model);
      if (!inv) throw new Error(`No mock for ${model}`);
      return inv;
    };

    const runner = new FallbackRunner({
      entries: [
        { model: 'slow-fail', priority: 0 },
        { model: 'ok-model', priority: 1 },
      ],
      invokerFactory: factory,
      eventBus,
    });

    await runner.run({ prompt: 'test' });
    expect(events).toHaveLength(1);
    const data = events[0].data as Record<string, unknown>;
    expect(data.from).toBe('slow-fail');
    expect(data.to).toBe('ok-model');
    expect(typeof data.latencyMs).toBe('number');
    expect(data.latencyMs as number).toBeGreaterThanOrEqual(0);
  });

  it('sorts entries by priority regardless of input order', async () => {
    const invokers = new Map<string, FallbackInvoker>();
    invokers.set(
      'low',
      createMockInvoker(async () => ({
        response: 'low priority',
        tokenUsage: { input: 1, output: 1 },
      })),
    );
    invokers.set(
      'high',
      createMockInvoker(async () => ({
        response: 'high priority',
        tokenUsage: { input: 1, output: 1 },
      })),
    );

    const factory = (model: string) => {
      const inv = invokers.get(model);
      if (!inv) throw new Error(`No mock for ${model}`);
      return inv;
    };

    // Given in reverse priority order
    const runner = new FallbackRunner({
      entries: [
        { model: 'low', priority: 5 },
        { model: 'high', priority: 0 },
      ],
      invokerFactory: factory,
    });

    const result = await runner.run({ prompt: 'test' });
    // Should pick highest priority (lowest number) first
    expect(result.response).toBe('high priority');
  });
});
