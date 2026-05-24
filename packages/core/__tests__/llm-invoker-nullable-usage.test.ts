import { describe, it, expect, vi } from 'vitest';
import { extractTokenUsage, LLMInvoker } from '../src/llm-invoker.js';
import { createEvaluateIterationProcessor } from '../src/processors/evaluate-iteration.js';
import { createMockLanguageModel } from './helpers.js';
import { ProcessorContextImpl } from '../src/processor-context.js';
import type { TokenUsage, PipelineContext } from '@primo-ai/sdk';
import { streamText } from 'ai';

// Mock streamText so we can selectively make its usage promise reject.
// Default: forward to the real implementation.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  const mockFn = vi.fn((...args: Parameters<typeof actual.streamText>) => actual.streamText(...args));
  return {
    ...actual,
    streamText: mockFn,
  } as any;
});

describe('extractTokenUsage', () => {
  it('returns null when usage is null', () => {
    expect(extractTokenUsage(null)).toBeNull();
  });

  it('returns null when usage is undefined', () => {
    expect(extractTokenUsage(undefined)).toBeNull();
  });

  it('returns correct values when usage has flat inputTokens/outputTokens', () => {
    const usage = { inputTokens: 100, outputTokens: 50 };
    expect(extractTokenUsage(usage)).toEqual({ input: 100, output: 50 });
  });

  it('returns correct values when usage has nested total format', () => {
    const usage = { inputTokens: { total: 100 }, outputTokens: { total: 50 } };
    expect(extractTokenUsage(usage)).toEqual({ input: 100, output: 50 });
  });
});

describe('LLMInvoker nullable usage - invoke', () => {
  it('returns valid tokenUsage when usage is available', async () => {
    const model = createMockLanguageModel({ text: 'Hello', inputTokens: 20, outputTokens: 5 });
    const invoker = new LLMInvoker({ model });
    const result = await invoker.invoke({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.response).toBe('Hello');
    expect(result.tokenUsage).toEqual({ input: 20, output: 5 });
  });
});

describe('LLMInvoker nullable usage - stream', () => {
  it('returns valid usage when stream resolves normally', async () => {
    const model = createMockLanguageModel({ text: 'Hello', inputTokens: 15, outputTokens: 3 });
    const invoker = new LLMInvoker({ model });
    const handle = invoker.stream({ messages: [{ role: 'user', content: 'hi' }] });

    for await (const _evt of handle.fullStream as AsyncIterable<Record<string, unknown>>) { void _evt; }

    const usage = await handle.usage;
    expect(usage).toEqual({ input: 15, output: 3 });
    expect(usage).not.toBeNull();
  });

  it('stream() usage promise returns null when result.usage rejects', async () => {
    const model = createMockLanguageModel({ text: 'Hello', inputTokens: 15, outputTokens: 3 });

    // Make streamText return a result whose usage promise rejects
    vi.mocked(streamText).mockImplementationOnce(() => {
      const realResult = vi.importActual('ai').then((mod: any) =>
        mod.streamText({ model, prompt: '' })
      );
      // We can't synchronously get the real result, so we construct a minimal mock
      // that provides the same fullStream but a rejecting usage promise
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'text-1' });
          controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Hello' });
          controller.enqueue({ type: 'text-end', id: 'text-1' });
          controller.enqueue({ type: 'finish', finishReason: { unified: 'stop' as const, raw: 'stop' }, usage: { inputTokens: 0, outputTokens: 0 } });
          controller.close();
        },
      });

      return {
        fullStream: errorStream,
        usage: Promise.reject(new Error('Usage tracking failed')),
        reasoningText: Promise.resolve(undefined),
        text: Promise.resolve('Hello'),
      } as any;
    });

    const invoker = new LLMInvoker({ model });
    const handle = invoker.stream({ messages: [{ role: 'user', content: 'hi' }] });

    // Consume the stream
    for await (const _evt of handle.fullStream as AsyncIterable<Record<string, unknown>>) { void _evt; }

    const usage = await handle.usage;
    expect(usage).toBeNull();
  });
});

describe('evaluate-iteration token:usage_unavailable event', () => {
  it('emits token:usage_unavailable when tokenUsage is null', async () => {
    const emitted: { type: string; data: unknown }[] = [];
    const eventBus = { emit: (type: string, data: unknown) => emitted.push({ type, data }) };

    const processor = createEvaluateIterationProcessor({ eventBus: eventBus as any });

    const ctx: PipelineContext = {
      agent: {
        config: { model: 'test' },
        promptFragments: [],
        toolDeclarations: [],
      },
      iteration: {
        step: 1,
        tokenUsage: null as unknown as TokenUsage | undefined,
      },
      session: {
        input: 'test',
        sessionId: 's1',
        custom: {},
      },
    };

    const pCtx = new ProcessorContextImpl(ctx);
    await processor.execute(pCtx);

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted.some(e => e.type === 'token:usage_unavailable')).toBe(true);
    // Result should still have a valid totalTokenUsage with zero fallback
    expect(pCtx.state.session.totalTokenUsage).toEqual({ input: 0, output: 0 });
  });

  it('does not emit token:usage_unavailable when tokenUsage is present', async () => {
    const emitted: { type: string; data: unknown }[] = [];
    const eventBus = { emit: (type: string, data: unknown) => emitted.push({ type, data }) };

    const processor = createEvaluateIterationProcessor({ eventBus: eventBus as any });

    const ctx: PipelineContext = {
      agent: {
        config: { model: 'test' },
        promptFragments: [],
        toolDeclarations: [],
      },
      iteration: {
        step: 1,
        tokenUsage: { input: 50, output: 25 } as TokenUsage,
      },
      session: {
        input: 'test',
        sessionId: 's2',
        custom: {},
      },
    };

    const pCtx = new ProcessorContextImpl(ctx);
    await processor.execute(pCtx);

    expect(emitted.some(e => e.type === 'token:usage_unavailable')).toBe(false);
    expect(pCtx.state.session.totalTokenUsage).toEqual({ input: 50, output: 25 });
  });
});
