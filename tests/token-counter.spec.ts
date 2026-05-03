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
    it('should count exact tokens for known text (gpt-4o)', () => {
      expect(counter.countTokens('Hello, world!')).toBe(4);
      expect(counter.countTokens('Hello')).toBe(1);
    });

    it('should return 0 for empty string', () => {
      expect(counter.countTokens('')).toBe(0);
    });

    it('should count more tokens for longer text', () => {
      const short = counter.countTokens('Hello');
      const long = counter.countTokens('Hello, this is a longer sentence with more words.');
      expect(short).toBe(1);
      expect(long).toBe(11);
      expect(long).toBeGreaterThan(short);
    });

    it('should handle CJK characters', () => {
      const tokens = counter.countTokens('你好世界');
      expect(tokens).toBe(2);
    });

    it('should cache results', () => {
      const text = 'Hello, world!';
      const first = counter.countTokens(text);
      const second = counter.countTokens(text);
      expect(first).toBe(second);
      expect(first).toBe(4);
    });
  });

  describe('countMessageTokens()', () => {
    it('should count tokens including 4-token overhead', () => {
      const message = { role: 'user' as const, content: 'Hello' };
      const tokens = counter.countMessageTokens(message);
      const contentOnly = counter.countTokens('Hello');
      expect(tokens).toBe(5);
      expect(tokens).toBe(contentOnly + 4);
    });
  });

  describe('countMessagesTokens()', () => {
    it('should count total tokens for multiple messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];
      const tokens = counter.countMessagesTokens(messages);
      expect(tokens).toBe(12);
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
    it('should use chars/4 heuristic for default model', () => {
      const heuristicCounter = new TokenCounter({ model: 'default' });
      expect(heuristicCounter.countTokens('Hello, world!')).toBe(4); // ceil(13/4)
      expect(heuristicCounter.countTokens('Hello')).toBe(2); // ceil(5/4)
    });

    it('should use chars/4 heuristic for claude model', () => {
      const claudeCounter = new TokenCounter({ model: 'claude' });
      expect(claudeCounter.countTokens('Hello, world!')).toBe(4); // ceil(13/4)
      expect(claudeCounter.countTokens('Hello')).toBe(2); // ceil(5/4)
    });
  });
});

describe('Convenience functions', () => {
  describe('countTokens()', () => {
    it('should count tokens using default heuristic', () => {
      const tokens = countTokens('Hello, world!');
      expect(tokens).toBe(4); // ceil(13/4) with default heuristic
    });
  });

  describe('countMessagesTokens()', () => {
    it('should count message tokens using default heuristic', () => {
      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const tokens = countMessagesTokens(messages);
      expect(tokens).toBe(6); // ceil(5/4) + 4 overhead
    });
  });
});
