import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Processor, StageHookInput, SuspensionSignal } from '@agentforge/sdk';

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
      eventBus.subscribe('stage:before', (data: unknown) => events.push(`before:${(data as StageHookInput).stage}`));
      eventBus.subscribe('stage:after', (data: unknown) => events.push(`after:${(data as StageHookInput).stage}`));

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
      eventBus.subscribe('stage:before', (data: unknown) => beforeContexts.push(data));
      eventBus.subscribe('stage:after', (data: unknown) => afterContexts.push(data));

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
      expect((afterContexts[0] as StageHookInput).context.session.custom.modified).toBe(true);
    });

    it('stage.before hook can mutate context before processor runs', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({
        point: 'stage.before',
        handler: (data: unknown) => {
          (data as StageHookInput).context.session.custom.injected = true;
        },
      });

      const runner = new PipelineRunner({ hookManager });
      let processorSawInjected = false;
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => {
          processorSawInjected = ctx.session.custom.injected === true;
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

  describe('SuspensionSignal', () => {
    it('stops the pipeline when a processor returns a SuspensionSignal', async () => {
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
        execute: async (ctx) => ({
          type: 'suspend' as const,
          suspensionId: 'sus-001',
          reason: 'needs approval',
          checkpoint: {
            context: ctx,
            nextStages: ['processStepOutput', 'executeTools'],
            iteration: ctx.iteration.step,
          },
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
        type: 'suspend',
        suspensionId: 'sus-001',
        reason: 'needs approval',
        checkpoint: {
          context: expect.any(Object),
          nextStages: ['processStepOutput', 'executeTools'],
          iteration: 0,
        },
      });
      expect(order).toEqual(['processInput']);
    });

    it('returns a SuspensionSignal with expiresAt', async () => {
      const runner = new PipelineRunner();
      const expiresAt = new Date(Date.now() + 60000).toISOString();

      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => ({
          type: 'suspend' as const,
          suspensionId: 'sus-002',
          reason: 'timeout test',
          checkpoint: { context: ctx, nextStages: [], iteration: 0 },
          expiresAt,
        }),
      });

      const result = await runner.run(makeContext(), ['invokeLLM']) as SuspensionSignal;

      expect(result.type).toBe('suspend');
      expect(result.expiresAt).toBe(expiresAt);
    });
  });

  describe('AbortSignal passthrough', () => {
    it('throws AbortError when signal is already aborted before run', async () => {
      const runner = new PipelineRunner();
      const controller = new AbortController();
      controller.abort();

      runner.register({
        stage: 'processInput',
        execute: async (ctx) => ctx,
      });

      await expect(runner.run(makeContext(), ['processInput'], { signal: controller.signal }))
        .rejects.toThrow('Pipeline aborted');
    });

    it('checks signal between stages and aborts mid-pipeline', async () => {
      const runner = new PipelineRunner();
      const controller = new AbortController();
      const order: string[] = [];

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
          controller.abort();
          return ctx;
        },
      });
      runner.register({
        stage: 'processOutput',
        execute: async (ctx) => {
          order.push('processOutput');
          return ctx;
        },
      });

      await expect(runner.run(makeContext(), ['processInput', 'invokeLLM', 'processOutput'], { signal: controller.signal }))
        .rejects.toThrow('Pipeline aborted');
      expect(order).toEqual(['processInput', 'invokeLLM']);
    });
  });

  describe('unregister / replace', () => {
    it('unregister removes all processors for a stage', async () => {
      const runner = new PipelineRunner();
      const order: string[] = [];

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
          return { ...ctx, iteration: { ...ctx.iteration, response: 'from-llm' } };
        },
      });

      runner.unregister('invokeLLM');
      const result = await runner.run(makeContext(), ['processInput', 'invokeLLM']);

      expect(order).toEqual(['processInput']);
      expect((result as PipelineContext).iteration.response).toBeUndefined();
    });

    it('replace swaps all processors for a stage', async () => {
      const runner = new PipelineRunner();
      const order: string[] = [];

      runner.register({
        stage: 'processInput',
        execute: async (ctx) => {
          order.push('original');
          return ctx;
        },
      });

      runner.replace('processInput', {
        stage: 'processInput',
        execute: async (ctx) => {
          order.push('replacement');
          return { ...ctx, session: { ...ctx.session, custom: { ...ctx.session.custom, replaced: true } } };
        },
      });

      const result = await runner.run(makeContext(), ['processInput']);
      expect(order).toEqual(['replacement']);
      expect((result as PipelineContext).session.custom.replaced).toBe(true);
    });

    it('replace with no prior processors still works', async () => {
      const runner = new PipelineRunner();

      runner.replace('invokeLLM', {
        stage: 'invokeLLM',
        execute: async (ctx) => ({ ...ctx, iteration: { ...ctx.iteration, response: 'mocked' } }),
      });

      const result = await runner.run(makeContext(), ['invokeLLM']);
      expect((result as PipelineContext).iteration.response).toBe('mocked');
    });
  });

  describe('empty stage skip optimization', () => {
    it('does not fire stage.before/after hooks for stages with no processors', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      const hookEvents: string[] = [];
      eventBus.subscribe('stage:before', (data: unknown) => hookEvents.push(`before:${(data as StageHookInput).stage}`));
      eventBus.subscribe('stage:after', (data: unknown) => hookEvents.push(`after:${(data as StageHookInput).stage}`));

      const runner = new PipelineRunner({ hookManager });
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => ctx,
      });
      // gateLLM and gateTool have NO registered processors

      await runner.run(makeContext(), ['processInput', 'gateLLM', 'gateTool']);

      expect(hookEvents).toEqual(['before:processInput', 'after:processInput']);
    });

    it('returns context unchanged for stages with no processors', async () => {
      const runner = new PipelineRunner();
      runner.register({
        stage: 'processInput',
        execute: async (ctx) => ({
          ...ctx,
          session: { ...ctx.session, custom: { ...ctx.session.custom, touched: true } },
        }),
      });

      const result = await runner.run(makeContext(), ['processInput', 'gateLLM', 'processStepOutput']);
      const ctx = result as PipelineContext;

      expect(ctx.session.custom.touched).toBe(true);
    });
  });

  describe('gate stages (gateLLM / gateTool)', () => {
    it('passes through transparently when no processor is registered', async () => {
      const runner = new PipelineRunner();
      const order: string[] = [];

      runner.register({
        stage: 'prepareStep',
        execute: async (ctx) => { order.push('prepareStep'); return ctx; },
      });
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => { order.push('invokeLLM'); return ctx; },
      });

      const result = await runner.run(makeContext(), ['prepareStep', 'gateLLM', 'invokeLLM']);

      expect(order).toEqual(['prepareStep', 'invokeLLM']);
      expect('type' in result).toBe(false);
    });

    it('aborts pipeline when gateLLM processor returns AbortSignal', async () => {
      const runner = new PipelineRunner();
      const order: string[] = [];

      runner.register({
        stage: 'gateLLM',
        execute: async () => ({ type: 'abort' as const, reason: 'quota exceeded' }),
      });
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => { order.push('invokeLLM'); return ctx; },
      });

      const result = await runner.run(makeContext(), ['gateLLM', 'invokeLLM']);

      expect(result).toEqual({ type: 'abort', reason: 'quota exceeded' });
      expect(order).toEqual([]);
    });

    it('suspends pipeline when gateTool processor returns SuspensionSignal', async () => {
      const runner = new PipelineRunner();
      const order: string[] = [];

      runner.register({
        stage: 'gateTool',
        execute: async (ctx) => ({
          type: 'suspend' as const,
          suspensionId: 'hitl-001',
          reason: 'requires human approval',
          checkpoint: { context: ctx, nextStages: ['executeTools'], iteration: 0 },
        }),
      });
      runner.register({
        stage: 'executeTools',
        execute: async (ctx) => { order.push('executeTools'); return ctx; },
      });

      const result = await runner.run(makeContext(), ['gateTool', 'executeTools']) as SuspensionSignal;

      expect(result.type).toBe('suspend');
      expect(result.suspensionId).toBe('hitl-001');
      expect(order).toEqual([]);
    });

    it('allows pipeline to continue when gate processor returns context', async () => {
      const runner = new PipelineRunner();
      const order: string[] = [];

      runner.register({
        stage: 'gateLLM',
        execute: async (ctx) => { order.push('gateLLM'); return ctx; },
      });
      runner.register({
        stage: 'invokeLLM',
        execute: async (ctx) => { order.push('invokeLLM'); return ctx; },
      });

      await runner.run(makeContext(), ['gateLLM', 'invokeLLM']);

      expect(order).toEqual(['gateLLM', 'invokeLLM']);
    });
  });
});
