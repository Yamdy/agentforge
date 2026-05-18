import { describe, it, expect } from 'vitest';
import { createCompressionStrategy } from '../src/compression/compression-processor.js';
import { TiktokenCounter } from '@primo-ai/core';
import type { HarnessAPI, Message } from '@primo-ai/sdk';

function makeTokenCounter(): TiktokenCounter {
  return new TiktokenCounter();
}

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `message ${i}`,
  }));
}

describe('createCompressionStrategy', () => {
  describe('prune phase', () => {
    it('removes oldest messages keeping only recent N', async () => {
      const tc = makeTokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 5,
        phases: [{ type: 'prune', keepRecent: 2 }],
      });

      const messages = makeMessages(10);
      const budget = 1;
      const result = await strategy(messages, tc, budget);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('message 8');
      expect(result[1].content).toBe('message 9');
    });
  });

  describe('truncate phase', () => {
    it('preserves recent messages over old ones when budget is limited', async () => {
      const tc = makeTokenCounter();
      // Small maxTokens forces dropping old messages
      const strategy = createCompressionStrategy({
        maxContextTokens: 5,
        phases: [{ type: 'truncate', maxTokens: 10 }],
      });

      const messages: Message[] = [
        { role: 'user', content: 'old question that is quite long to consume many tokens' },
        { role: 'assistant', content: 'old answer that is also quite long to consume tokens' },
        { role: 'user', content: 'recent question' },
        { role: 'assistant', content: 'recent answer' },
      ];

      const budget = 1;
      const result = await strategy(messages, tc, budget);

      // Recent messages should survive, old ones should be dropped
      expect(result.length).toBeLessThan(messages.length);
      const contents = result.map(m => m.content);
      expect(contents).toContain('recent question');
      expect(contents).toContain('recent answer');
    });

    it('does not lose all messages when first message exceeds budget', async () => {
      const tc = makeTokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 5,
        phases: [{ type: 'truncate', maxTokens: 10 }],
      });

      const messages: Message[] = [
        { role: 'user', content: 'A'.repeat(200) },
        { role: 'assistant', content: 'short reply' },
      ];

      const budget = 1;
      const result = await strategy(messages, tc, budget);

      expect(result.length).toBeGreaterThan(0);
      expect(result[result.length - 1].content).toContain('short reply');
    });
  });

  describe('threshold check', () => {
    it('does nothing when token count is under budget', async () => {
      const tc = makeTokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 5,
        phases: [
          { type: 'prune', keepRecent: 1 },
        ],
      });

      const messages: Message[] = [
        { role: 'user', content: 'hello world' },
        { role: 'assistant', content: 'hi there' },
      ];

      const budget = tc.countMessages(messages) + 1000;
      const result = await strategy(messages, tc, budget);

      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('hello world');
      expect(result[1].content).toBe('hi there');
    });

    it('returns original messages when budget is sufficient', async () => {
      const tc = makeTokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 10,
        phases: [{ type: 'prune', keepRecent: 1 }],
      });

      const messages = makeMessages(3);
      const budget = tc.countMessages(messages) + 1000;
      const result = await strategy(messages, tc, budget);
      expect(result).toHaveLength(3);
    });
  });

  describe('summarize phase', () => {
    it('replaces messages with summary', async () => {
      const summaryText = 'Summary of earlier conversation';
      const summarizeFn = async (_messages: Message[]): Promise<string> => summaryText;

      const tc = makeTokenCounter();
      const strategy = createCompressionStrategy({
        maxContextTokens: 5,
        phases: [{ type: 'summarize', model: 'test', maxTokens: 100, summarizeFn }],
      });

      const messages: Message[] = [
        { role: 'user', content: 'old question one' },
        { role: 'assistant', content: 'old answer one' },
        { role: 'user', content: 'old question two' },
        { role: 'assistant', content: 'old answer two' },
        { role: 'user', content: 'recent question' },
      ];

      const budget = 1;
      const result = await strategy(messages, tc, budget);

      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe(summaryText);
      expect(result.length).toBeLessThan(messages.length);
    });
  });
});

describe('createSummarizeFn', () => {
  it('returns a function', async () => {
    const { createSummarizeFn } = await import('../src/compression/compression-processor.js');
    const getLLM = () => ({ invoke: async () => ({ response: 'summary', tokenUsage: null }) });
    const fn = createSummarizeFn(getLLM);
    expect(typeof fn).toBe('function');
  });

  it('calls getLLM with the provided model name', async () => {
    const { createSummarizeFn } = await import('../src/compression/compression-processor.js');
    const getModelArg: string[] = [];
    const getLLM = (model: string) => {
      getModelArg.push(model);
      return { invoke: async () => ({ response: 'summary', tokenUsage: null }) };
    };
    const fn = createSummarizeFn(getLLM, 'gpt-4');
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    await fn(messages);
    expect(getModelArg).toContain('gpt-4');
  });

  it('calls getLLM with default model when none provided', async () => {
    const { createSummarizeFn } = await import('../src/compression/compression-processor.js');
    const getModelArg: string[] = [];
    const getLLM = (model: string) => {
      getModelArg.push(model);
      return { invoke: async () => ({ response: 'summary', tokenUsage: null }) };
    };
    const fn = createSummarizeFn(getLLM);
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    await fn(messages);
    expect(getModelArg).toContain('default');
  });

  it('passes message content in the LLM prompt', async () => {
    const { createSummarizeFn } = await import('../src/compression/compression-processor.js');
    let capturedMessages: unknown[] = [];
    const getLLM = () => ({
      invoke: async (input: { messages: unknown[] }) => {
        capturedMessages = input.messages;
        return { response: 'summary', tokenUsage: null };
      },
    });
    const fn = createSummarizeFn(getLLM);
    const messages: Message[] = [
      { role: 'user', content: 'question one' },
      { role: 'assistant', content: 'answer one' },
    ];
    await fn(messages);
    const userMsg = capturedMessages.find(m => (m as { role: string }).role === 'user');
    expect(userMsg).toBeDefined();
    const content = (userMsg as { content: string }).content;
    expect(content).toContain('question one');
    expect(content).toContain('answer one');
  });

  it('returns the LLM response text', async () => {
    const { createSummarizeFn } = await import('../src/compression/compression-processor.js');
    const getLLM = () => ({
      invoke: async () => ({ response: 'This is the summary text.', tokenUsage: null }),
    });
    const fn = createSummarizeFn(getLLM);
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const result = await fn(messages);
    expect(result).toBe('This is the summary text.');
  });

  it('handles LLM failure gracefully without throwing', async () => {
    const { createSummarizeFn } = await import('../src/compression/compression-processor.js');
    const getLLM = () => ({
      invoke: async () => { throw new Error('API error'); },
    });
    const fn = createSummarizeFn(getLLM);
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    await expect(fn(messages)).resolves.not.toThrow();
    const result = await fn(messages);
    expect(result).toContain('Summary unavailable');
  });
});

describe('compressionPlugin', () => {
  function createHarnessAPI(): { api: HarnessAPI } {
    const api: HarnessAPI = {
      registerProcessor: () => {},
      registerTool: () => {},
      unregisterTool: () => false,
      registerCommand: () => {},
      registerHook: () => {},
      subscribe: () => () => {},
      registerResource: () => {},
      registerProvider: () => {},
      registerCompressionStrategy: () => {},
      emit: () => {},
    };
    return { api };
  }

  it('registers compression strategy via HarnessAPI', async () => {
    const { api } = createHarnessAPI();
    const { compressionPlugin } = await import('../src/compression/index.js');
    const registration = compressionPlugin({
      maxContextTokens: 1000,
      phases: [{ type: 'prune', keepRecent: 10 }],
    })(api);

    expect(registration.compressionStrategy).toBeDefined();
  });
});
