import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
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

  it('consumes textStream from processor into response', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'invokeLLM',
      execute: async (ctx) => ({
        ...ctx,
        iteration: {
          ...ctx.iteration,
          textStream: (async function* () {
            yield 'hello ';
            yield 'world';
          })(),
          usagePromise: Promise.resolve({ input: 10, output: 2 }),
        },
      }),
    });

    const result = await runner.run(makeContext(), ['invokeLLM']);
    const ctx = result as PipelineContext;
    expect(ctx.iteration.response).toBe('hello world');
    expect(ctx.iteration.tokenUsage).toEqual({ input: 10, output: 2 });
    expect(ctx.iteration.textStream).toBeUndefined();
    expect(ctx.iteration.usagePromise).toBeUndefined();
  });
});
