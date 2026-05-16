import { describe, it, expect } from 'vitest';
import { createCompressionStrategy } from '../src/compression/compression-processor.js';
import { TiktokenCounter } from '@agentforge/core';
import type { HarnessAPI, Message } from '@agentforge/sdk';

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
