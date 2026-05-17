import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../src/serialize.js';
import type { PipelineContext } from '@primo-ai/sdk';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'hello', sessionId: 'sess-1' },
    agent: {
      config: { model: 'test/model' },
      systemPrompt: 'You are helpful',
      toolDeclarations: [{ name: 'echo', description: 'echo tool' }],
      promptFragments: ['fragment-1'],
    },
    iteration: {
      step: 3,
      loopDirective: { action: 'stop' },
      response: 'done',
      tokenUsage: { input: 100, output: 50 },
      reasoningContent: 'thinking...',
      toolResults: [{ toolCallId: 'c1', name: 'echo', output: 'hello' }],
      pendingToolCalls: [{ id: 'c2', name: 'read', args: { path: '/tmp' } }],
    },
    session: {
      messageHistory: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', toolCalls: [{ id: 'c1', name: 'echo', args: {} }] },
      ],
      totalTokenUsage: { input: 200, output: 100 },
      custom: { pluginX: { data: 42 } },
    },
    ...overrides,
  };
}

describe('serialize', () => {
  it('strips non-serializable fields (fullStream, usagePromise, reasoningPromise, span)', () => {
    const ctx = makeContext({
      iteration: {
        step: 0,
        fullStream: (async function* () { yield 'x'; })(),
        usagePromise: Promise.resolve({ input: 1, output: 1 }),
        reasoningPromise: Promise.resolve('reason'),
        span: { name: 'test', end: () => {}, setAttribute: () => ({} as unknown as import('@primo-ai/sdk').Span), startChild: () => ({} as unknown as import('@primo-ai/sdk').Span), addEvent: () => ({} as unknown as import('@primo-ai/sdk').Span), spanContext: () => ({ spanId: '', traceId: '' }) },
      },
    });

    const serialized = serialize(ctx);
    const iter = serialized.iteration as Record<string, unknown>;

    expect(iter['fullStream']).toBeUndefined();
    expect(iter['usagePromise']).toBeUndefined();
    expect(iter['reasoningPromise']).toBeUndefined();
    expect(iter['span']).toBeUndefined();
  });

  it('preserves all serializable fields', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);

    expect(serialized.request).toEqual({ input: 'hello', sessionId: 'sess-1' });
    expect(serialized.agent.config).toEqual({ model: 'test/model' });
    expect(serialized.agent.promptFragments).toEqual(['fragment-1']);
    expect(serialized.iteration.step).toBe(3);
    expect(serialized.iteration.response).toBe('done');
    expect(serialized.session.messageHistory).toHaveLength(2);
    expect(serialized.session.custom).toEqual({ pluginX: { data: 42 } });
  });

  it('produces JSON-serializable output', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const json = JSON.stringify(serialized);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('deserialize', () => {
  it('reconstructs a valid PipelineContext', () => {
    const ctx = makeContext();
    const serialized = serialize(ctx);
    const restored = deserialize(serialized);

    expect(restored.request).toEqual(ctx.request);
    expect(restored.agent.config).toEqual(ctx.agent.config);
    expect(restored.agent.promptFragments).toEqual(ctx.agent.promptFragments);
    expect(restored.iteration.step).toBe(3);
    expect(restored.session.messageHistory).toEqual(ctx.session.messageHistory);
  });

  it('round-trip preserves data through serialize then deserialize', () => {
    const ctx = makeContext();
    const json = JSON.stringify(serialize(ctx));
    const restored = deserialize(JSON.parse(json));

    expect(restored.request.input).toBe('hello');
    expect(restored.agent.toolDeclarations).toEqual([{ name: 'echo', description: 'echo tool' }]);
    expect(restored.iteration.loopDirective).toEqual({ action: 'stop' });
    expect(restored.session.totalTokenUsage).toEqual({ input: 200, output: 100 });
  });
});
