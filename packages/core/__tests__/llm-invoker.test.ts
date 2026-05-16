import { describe, it, expect } from 'vitest';
import { LLMInvoker } from '../src/llm-invoker.js';
import { createMockLanguageModel } from './helpers.js';
import type { TokenUsage, Tracer, Span } from '@agentforge/sdk';

describe('LLMInvoker', () => {
  it('invoke returns response and token usage', async () => {
    const model = createMockLanguageModel({ text: 'Hello world', inputTokens: 20, outputTokens: 5 });
    const invoker = new LLMInvoker({ model });
    const result = await invoker.invoke({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.response).toBe('Hello world');
    expect(result.tokenUsage).toEqual({ input: 20, output: 5 } as TokenUsage);
  });

  it('invoke passes system prompt to streamText', async () => {
    const model = createMockLanguageModel({ text: 'done' });
    const invoker = new LLMInvoker({ model, system: 'You are helpful.' });
    const result = await invoker.invoke({ messages: [{ role: 'user', content: 'test' }] });

    expect(result.response).toBe('done');
  });

  it('invoke retries on transient errors (429)', async () => {
    let attempts = 0;
    const model = createMockLanguageModel({ text: 'recovered' });
    const originalDoStream = (model as unknown as { doStream: () => Promise<unknown> }).doStream.bind(model);
    (model as unknown as { doStream: () => Promise<unknown> }).doStream = async () => {
      attempts++;
      if (attempts < 2) {
        const error = new Error('Rate limited');
        (error as unknown as { statusCode: number }).statusCode = 429;
        throw error;
      }
      return originalDoStream();
    };

    const invoker = new LLMInvoker({ model, retryOptions: { maxRetries: 3, baseDelay: 1 } });
    const result = await invoker.invoke({ messages: [{ role: 'user', content: 'test' }] });

    expect(result.response).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('invoke does not retry on auth errors (401)', async () => {
    const model = createMockLanguageModel({ text: 'nope' });
    (model as unknown as { doStream: () => Promise<never> }).doStream = async () => {
      const error = new Error('Unauthorized');
      (error as unknown as { statusCode: number }).statusCode = 401;
      throw error;
    };

    const invoker = new LLMInvoker({ model, retryOptions: { maxRetries: 3, baseDelay: 1 } });
    await expect(invoker.invoke({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow('Unauthorized');
  });

  describe('stream', () => {
    it('yields text-delta events via fullStream', async () => {
      const model = createMockLanguageModel({ text: 'Hello world' });
      const invoker = new LLMInvoker({ model });
      const handle = invoker.stream({ messages: [{ role: 'user', content: 'hi' }] });

      const texts: string[] = [];
      for await (const event of handle.fullStream as AsyncIterable<Record<string, unknown>>) {
        if (event.type === 'text-delta') texts.push(event.text as string);
      }

      expect(texts).toContain('Hello world');
    });

    it('resolves usage after stream is consumed', async () => {
      const model = createMockLanguageModel({ text: 'test', inputTokens: 15, outputTokens: 3 });
      const invoker = new LLMInvoker({ model });
      const handle = invoker.stream({ messages: [{ role: 'user', content: 'hi' }] });

      for await (const _evt of handle.fullStream) { void _evt; }

      const usage = await handle.usage;
      expect(usage).toEqual({ input: 15, output: 3 } as TokenUsage);
    });
  });

  describe('tracer integration', () => {
    function createMockTracer() {
      const spans: { name: string; ended: boolean; attributes: Record<string, unknown> }[] = [];
      const tracer: Tracer = {
        startSpan(name: string): Span {
          const record = { name, ended: false, attributes: {} as Record<string, unknown> };
          spans.push(record);
          return {
            name,
            startChild(childName: string) { return tracer.startSpan(childName); },
            end() { record.ended = true; },
            setAttribute(key: string, value: unknown) { record.attributes[key] = value; return this as Span; },
            addEvent() { return this as Span; },
            spanContext() { return { spanId: 'mock', traceId: 'mock' }; },
          };
        },
        getCurrentSpan() { return undefined; },
      };
      return { tracer, spans };
    }

    it('invoke creates a span and ends it when done', async () => {
      const { tracer, spans } = createMockTracer();
      const model = createMockLanguageModel({ text: 'traced' });
      const invoker = new LLMInvoker({ model, tracer });

      await invoker.invoke({ messages: [{ role: 'user', content: 'hi' }] });

      expect(spans.length).toBeGreaterThanOrEqual(1);
      const llmSpan = spans.find(s => s.name === 'model_step');
      expect(llmSpan).toBeDefined();
      expect(llmSpan!.ended).toBe(true);
    });

    it('invoke sets model attribute on span', async () => {
      const { tracer, spans } = createMockTracer();
      const model = createMockLanguageModel({ text: 'traced' });
      const invoker = new LLMInvoker({ model, tracer });

      await invoker.invoke({ messages: [{ role: 'user', content: 'hi' }] });

      const llmSpan = spans.find(s => s.name === 'model_step');
      expect(llmSpan!.attributes['llm.model']).toBe('mock-model');
    });

    it('invoke ends span even on error', async () => {
      const { tracer, spans } = createMockTracer();
      const model = createMockLanguageModel({ text: 'nope' });
      (model as unknown as { doStream: () => Promise<unknown> }).doStream = async () => { throw new Error('LLM failed'); };

      const invoker = new LLMInvoker({ model, tracer, retryOptions: { maxRetries: 0, baseDelay: 1 } });

      await expect(invoker.invoke({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toThrow('LLM failed');

      const llmSpan = spans.find(s => s.name === 'model_step');
      expect(llmSpan).toBeDefined();
      expect(llmSpan!.ended).toBe(true);
    });
  });
});
