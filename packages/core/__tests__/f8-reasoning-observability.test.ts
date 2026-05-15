import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenUsage } from '@agentforge/sdk';

// Mock the ai module before importing LLMInvoker
vi.mock('ai', () => ({
  streamText: vi.fn(),
}));

import { streamText } from 'ai';
import { LLMInvoker } from '../src/llm-invoker.js';

describe('F-8: Stream reasoning error observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits llm:reasoning_error when reasoningText promise rejects', async () => {
    const emitted: Array<{ type: string; data: unknown }> = [];
    const fakeEventBus = {
      emit: (type: string, data: unknown) => { emitted.push({ type, data }); },
    };

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 't-1' });
        controller.enqueue({ type: 'text-delta', id: 't-1', delta: 'ok' });
        controller.enqueue({ type: 'text-end', id: 't-1' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: 1, outputTokens: 1 },
        });
        controller.close();
      },
    });

    (streamText as ReturnType<typeof vi.fn>).mockReturnValue({
      fullStream: stream,
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      reasoningText: Promise.reject(new Error('reasoning pipeline crashed')),
      text: Promise.resolve('ok'),
    });

    const invoker = new LLMInvoker({
      model: { modelId: 'test/model', specificationVersion: 'v3', provider: 'test', supportedUrls: {} } as any,
      eventBus: fakeEventBus as any,
    });

    const handle = invoker.stream({ messages: [{ role: 'user', content: 'test' }] });

    // Reasoning should resolve to undefined (swallowed), but emit event
    const reasoning = await handle.reasoning;
    expect(reasoning).toBeUndefined();

    // The key assertion: event must have been emitted
    expect(emitted.some(e => e.type === 'llm:reasoning_error')).toBe(true);
    const evt = emitted.find(e => e.type === 'llm:reasoning_error')!;
    expect((evt.data as any).error).toContain('reasoning pipeline crashed');
  });
});
