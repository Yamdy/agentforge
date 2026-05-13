import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Processor } from '@agentforge/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('PipelineRunner', () => {
  it('runs a single processor and returns modified context', async () => {
    const runner = new PipelineRunner();
    const processor: Processor = {
      stage: 'processInput',
      execute: async (ctx) => ({
        ...ctx,
        session: { ...ctx.session, custom: { ...ctx.session.custom, transformed: true } },
      }),
    };
    runner.register(processor);

    const result = await runner.run(makeContext(), ['processInput']);

    expect('type' in result ? null : result.session.custom.transformed).toBe(true);
  });

  it('executes processors in registration order within the same stage', async () => {
    const order: string[] = [];
    const runner = new PipelineRunner();

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => {
        order.push('first');
        return { ...ctx, session: { ...ctx.session, custom: { ...ctx.session.custom, step: 'first' } } };
      },
    });
    runner.register({
      stage: 'processInput',
      execute: async (ctx) => {
        order.push('second');
        return { ...ctx, session: { ...ctx.session, custom: { ...ctx.session.custom, step: 'second' } } };
      },
    });

    const result = await runner.run(makeContext(), ['processInput']);
    expect(order).toEqual(['first', 'second']);
    expect('type' in result ? null : result.session.custom.step).toBe('second');
  });

  it('runs stages in the specified order', async () => {
    const order: string[] = [];
    const runner = new PipelineRunner();

    runner.register({
      stage: 'processOutput',
      execute: async (ctx) => {
        order.push('processOutput');
        return ctx;
      },
    });
    runner.register({
      stage: 'processInput',
      execute: async (ctx) => {
        order.push('processInput');
        return ctx;
      },
    });
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        order.push('invokeLLM');
        return ctx;
      },
    });

    await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);
    expect(order).toEqual(['processInput', 'invokeLLM', 'processOutput']);
  });

  it('stops the pipeline when a processor returns an AbortSignal', async () => {
    const order: string[] = [];
    const runner = new PipelineRunner();

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => {
        order.push('processInput');
        return ctx;
      },
    });
    runner.register({
      stage: 'invokeLLM',
      execute: async () => ({
        type: 'abort' as const,
        reason: 'content policy violation',
      }),
    });
    runner.register({
      stage: 'processOutput',
      execute: async (ctx) => {
        order.push('processOutput');
        return ctx;
      },
    });

    const result = await runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput']);

    expect(result).toEqual({
      type: 'abort',
      reason: 'content policy violation',
    });
    expect(order).toEqual(['processInput']);
  });

  it('freezes context between stages to prevent mutation', async () => {
    let frozenContext: PipelineContext | null = null;
    const runner = new PipelineRunner();

    runner.register({
      stage: 'processInput',
      execute: async (ctx) => ({ ...ctx, session: { ...ctx.session, custom: { ...ctx.session.custom, stage: 'input' } } }),
    });
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        frozenContext = ctx;
        return ctx;
      },
    });

    await runner.run(makeContext(), ['processInput', 'invokeLLM']);

    expect(frozenContext).not.toBeNull();
    expect(() => {
      (frozenContext as PipelineContext).iteration = { step: 999 };
    }).toThrow();
  });

  it('consumes fullStream from processor into response', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => ({
        ...ctx,
        iteration: {
          ...ctx.iteration,
          fullStream: (async function* () {
            yield { type: 'text-delta', text: 'hello ' };
            yield { type: 'text-delta', text: 'world' };
            yield { type: 'finish-step', usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 2, text: 2 } } };
          })(),
          usagePromise: Promise.resolve({ input: 10, output: 2 }),
        },
      }),
    });

    const result = await runner.run(makeContext(), ['invokeLLM']);
    const ctx = result as PipelineContext;
    expect(ctx.iteration.response).toBe('hello world');
    expect(ctx.iteration.tokenUsage).toEqual({ input: 10, output: 2 });
    expect(ctx.iteration.fullStream).toBeUndefined();
    expect(ctx.iteration.usagePromise).toBeUndefined();
  });

  describe('with HookManager wired', () => {
    it('invokes stage.before and stage.after hooks around each stage', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      const events: string[] = [];
      eventBus.subscribe('stage:before', (data: any) => events.push(`before:${data.stage}`));
      eventBus.subscribe('stage:after', (data: any) => events.push(`after:${data.stage}`));

      const runner = new PipelineRunner({ hookManager });
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => ctx,
      });
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ctx,
      });

      await runner.run(makeContext(), ['processInput', 'invokeLLM']);

      expect(events).toEqual([
        'before:processInput', 'after:processInput',
        'before:invokeLLM', 'after:invokeLLM',
      ]);
    });

    it('hooks receive context at each stage boundary', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      const beforeContexts: unknown[] = [];
      const afterContexts: unknown[] = [];
      eventBus.subscribe('stage:before', (data: any) => beforeContexts.push(data));
      eventBus.subscribe('stage:after', (data: any) => afterContexts.push(data));

      const runner = new PipelineRunner({ hookManager });
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => ({
          ...ctx,
          session: { ...ctx.session, custom: { ...ctx.session.custom, modified: true } },
        }),
      });

      await runner.run(makeContext(), ['processInput']);

      expect(beforeContexts).toHaveLength(1);
      expect(afterContexts).toHaveLength(1);
      expect((afterContexts[0] as any).context.session.custom.modified).toBe(true);
    });

    it('stage.before hook can mutate context before processor runs', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({
        point: 'stage.before',
        handler: (data: any) => {
          data.context.session.custom.injected = true;
        },
      });

      const runner = new PipelineRunner({ hookManager });
      let processorSawInjected = false;
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => {
          processorSawInjected = (ctx.session.custom as any).injected === true;
          return ctx;
        },
      });

      await runner.run(makeContext(), ['processInput']);
      expect(processorSawInjected).toBe(true);
    });

    it('still emits events when no hooks are registered for a point', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      const events: string[] = [];
      eventBus.subscribe('stage:before', () => events.push('before'));
      eventBus.subscribe('stage:after', () => events.push('after'));

      const runner = new PipelineRunner({ hookManager });
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => ctx,
      });

      await runner.run(makeContext(), ['processInput']);
      expect(events).toEqual(['before', 'after']);
    });
  });
});
