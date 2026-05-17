import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { LLMInvoker } from '../src/llm-invoker.js';
import { createMockLanguageModel } from './helpers.js';

describe('LLMInvoker edge cases', () => {
  // ---------------------------------------------------------------------------
  // Retry exhaustion
  // ---------------------------------------------------------------------------

  it('throws after exhausting all retry attempts', async () => {
    const model = createMockLanguageModel({ text: 'never' });
    (model as unknown as { doStream: () => Promise<unknown> }).doStream = async () => {
      const error = new Error('Server error');
      (error as unknown as { statusCode: number }).statusCode = 500;
      throw error;
    };

    const invoker = new LLMInvoker({ model, retryOptions: { maxRetries: 2, baseDelay: 1 } });
    await expect(invoker.invoke({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toThrow('Server error');
  });

  it('retries on 503 service unavailable', async () => {
    let attempts = 0;
    const model = createMockLanguageModel({ text: 'recovered' });
    const originalDoStream = (model as unknown as { doStream: () => Promise<unknown> }).doStream.bind(model);
    (model as unknown as { doStream: () => Promise<unknown> }).doStream = async () => {
      attempts++;
      if (attempts < 2) {
        const error = new Error('Service Unavailable');
        (error as unknown as { statusCode: number }).statusCode = 503;
        throw error;
      }
      return originalDoStream();
    };

    const invoker = new LLMInvoker({ model, retryOptions: { maxRetries: 3, baseDelay: 1 } });
    const result = await invoker.invoke({ messages: [{ role: 'user', content: 'test' }] });
    expect(result.response).toBe('recovered');
    expect(attempts).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Tools + providerOptions
  // ---------------------------------------------------------------------------

  it('invoke passes tools with Zod schema to streamText', async () => {
    const model = createMockLanguageModel({ text: 'tool result' });
    const invoker = new LLMInvoker({ model });

    const tools = {
      search: {
        description: 'Search',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => 'found',
      },
    };

    const result = await invoker.invoke({
      messages: [{ role: 'user', content: 'search for X' }],
      tools,
    });

    expect(result.response).toBe('tool result');
  });

  it('invoke passes providerOptions to streamText', async () => {
    const model = createMockLanguageModel({ text: 'with options' });
    const invoker = new LLMInvoker({ model });

    const result = await invoker.invoke({
      messages: [{ role: 'user', content: 'test' }],
      providerOptions: { deepseek: { reasoning: { include_summary: true } } },
    });

    expect(result.response).toBe('with options');
  });

  it('stream passes tools with Zod schema to streamText', async () => {
    const model = createMockLanguageModel({ text: 'stream tools' });
    const invoker = new LLMInvoker({ model });

    const handle = invoker.stream({
      messages: [{ role: 'user', content: 'test' }],
      tools: {
        calc: {
          description: 'Calculate',
          inputSchema: z.object({ expr: z.string() }),
          execute: async () => 42,
        },
      },
    });

    const texts: string[] = [];
    for await (const event of handle.fullStream as AsyncIterable<Record<string, unknown>>) {
      if (event.type === 'text-delta') texts.push(event.text as string);
    }
    expect(texts).toContain('stream tools');
  });

  it('stream passes providerOptions to streamText', async () => {
    const model = createMockLanguageModel({ text: 'stream opts' });
    const invoker = new LLMInvoker({ model });

    const handle = invoker.stream({
      messages: [{ role: 'user', content: 'test' }],
      providerOptions: { openai: { store: true } },
    });

    for await (const _unused of handle.fullStream) { void _unused; }
    const usage = await handle.usage;
    expect(usage).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Usage / reasoning fallbacks
  // ---------------------------------------------------------------------------

  it('stream returns usage from model', async () => {
    const model = createMockLanguageModel({ text: 'test', inputTokens: 15, outputTokens: 3 });
    const invoker = new LLMInvoker({ model });

    const handle = invoker.stream({ messages: [{ role: 'user', content: 'test' }] });
    for await (const _unused of handle.fullStream) { void _unused; }

    const usage = await handle.usage;
    expect(usage).not.toBeNull();
    if (usage) {
      expect(typeof usage.input).toBe('number');
      expect(typeof usage.output).toBe('number');
    }
  });

  it('stream resolves reasoning promise (undefined for non-reasoning models)', async () => {
    const model = createMockLanguageModel({ text: 'test' });
    const invoker = new LLMInvoker({ model });

    const handle = invoker.stream({ messages: [{ role: 'user', content: 'test' }] });
    for await (const _unused of handle.fullStream) { void _unused; }

    const reasoning = await handle.reasoning;
    expect(reasoning).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Non-Error throw
  // ---------------------------------------------------------------------------

  it('invoke handles model that throws non-Error object', async () => {
    const model = createMockLanguageModel({ text: 'nope' });
    (model as unknown as { doStream: () => Promise<unknown> }).doStream = async () => {
      throw 'string error';
    };

    const invoker = new LLMInvoker({ model, retryOptions: { maxRetries: 0, baseDelay: 1 } });
    await expect(invoker.invoke({ messages: [{ role: 'user', content: 'test' }] }))
      .rejects.toBe('string error');
  });
});
