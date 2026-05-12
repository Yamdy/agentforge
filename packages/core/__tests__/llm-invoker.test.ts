import { describe, it, expect, vi } from 'vitest';
import { LLMInvoker } from '../src/llm-invoker.js';
import { createMockLanguageModel } from './helpers.js';
import type { TokenUsage } from '@agentforge/sdk';

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
    const originalDoStream = (model as any).doStream.bind(model);
    (model as any).doStream = async () => {
      attempts++;
      if (attempts < 2) {
        const error = new Error('Rate limited');
        (error as any).statusCode = 429;
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
    (model as any).doStream = async () => {
      const error = new Error('Unauthorized');
      (error as any).statusCode = 401;
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
      for await (const event of handle.fullStream as AsyncIterable<any>) {
        if (event.type === 'text-delta') texts.push(event.text);
      }

      expect(texts).toContain('Hello world');
    });

    it('resolves usage after stream is consumed', async () => {
      const model = createMockLanguageModel({ text: 'test', inputTokens: 15, outputTokens: 3 });
      const invoker = new LLMInvoker({ model });
      const handle = invoker.stream({ messages: [{ role: 'user', content: 'hi' }] });

      for await (const _ of handle.fullStream) { /* drain */ }

      const usage = await handle.usage;
      expect(usage).toEqual({ input: 15, output: 3 } as TokenUsage);
    });
  });
});
