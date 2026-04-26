/**
 * Token Counter Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenCounter, countTokens, countMessagesTokens } from '../src/token-counter.js';

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeEach(() => {
    counter = new TokenCounter({ model: 'gpt-4o' });
  });

  describe('countTokens()', () => {
    it('should count tokens for simple text', () => {
      const tokens = counter.countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      expect(counter.countTokens('')).toBe(0);
    });

    it('should count more tokens for longer text', () => {
      const short = counter.countTokens('Hello');
      const long = counter.countTokens('Hello, this is a longer sentence with more words.');
      expect(long).toBeGreaterThan(short);
    });

    it('should handle CJK characters', () => {
      const tokens = counter.countTokens('你好世界');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should cache results', () => {
      const text = 'Hello, world!';
      const first = counter.countTokens(text);
      const second = counter.countTokens(text);
      expect(first).toBe(second);
    });
  });

  describe('countMessageTokens()', () => {
    it('should count tokens including overhead', () => {
      const message = { role: 'user' as const, content: 'Hello' };
      const tokens = counter.countMessageTokens(message);
      expect(tokens).toBeGreaterThan(0);
      // Should include overhead (~4 tokens)
      const contentOnly = counter.countTokens('Hello');
      expect(tokens).toBeGreaterThan(contentOnly);
    });
  });

  describe('countMessagesTokens()', () => {
    it('should count total tokens for multiple messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      const tokens = counter.countMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should return 0 for empty array', () => {
      expect(counter.countMessagesTokens([])).toBe(0);
    });
  });

  describe('clearCache()', () => {
    it('should clear the cache', () => {
      counter.countTokens('Hello');
      counter.clearCache();
      const stats = counter.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('getCacheStats()', () => {
    it('should return cache statistics', () => {
      counter.countTokens('Hello');
      counter.countTokens('World');
      const stats = counter.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(1000);
      expect(stats.enabled).toBe(true);
    });
  });

  describe('heuristic fallback', () => {
    it('should use heuristic for default model', () => {
      const heuristicCounter = new TokenCounter({ model: 'default' });
      const tokens = heuristicCounter.countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
    });

    it('should use heuristic for claude model', () => {
      const claudeCounter = new TokenCounter({ model: 'claude' });
      const tokens = claudeCounter.countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
    });
  });
});

describe('Convenience functions', () => {
  describe('countTokens()', () => {
    it('should count tokens', () => {
      const tokens = countTokens('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('countMessagesTokens()', () => {
    it('should count message tokens', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
      ];
      const tokens = countMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });
  });
});
