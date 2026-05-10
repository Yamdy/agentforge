import { describe, it, expect } from 'vitest';
import { InMemoryBackend } from '../src/memory/in-memory-backend.js';

describe('InMemoryBackend', () => {
  describe('store + retrieve', () => {
    it('stores and retrieves a memory entry', async () => {
      const backend = new InMemoryBackend();
      const entry = {
        role: 'user' as const,
        content: 'Hello agent',
        timestamp: new Date().toISOString(),
      };

      await backend.store('session-1', entry);
      const results = await backend.retrieve('session-1');

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('user');
      expect(results[0].content).toBe('Hello agent');
      expect(results[0].timestamp).toBe(entry.timestamp);
    });

    it('returns empty array for unknown session', async () => {
      const backend = new InMemoryBackend();
      const results = await backend.retrieve('no-such-session');
      expect(results).toEqual([]);
    });

    it('limits results with query.limit', async () => {
      const backend = new InMemoryBackend();
      for (let i = 0; i < 5; i++) {
        await backend.store('s1', {
          role: 'user',
          content: `msg-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        });
      }
      const results = await backend.retrieve('s1', { limit: 2 });
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('msg-3');
      expect(results[1].content).toBe('msg-4');
    });
  });

  describe('search', () => {
    it('searches across all sessions by content', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s1', {
        role: 'user',
        content: 'What is the weather today?',
        timestamp: new Date().toISOString(),
      });
      await backend.store('s2', {
        role: 'assistant',
        content: 'The weather is sunny.',
        timestamp: new Date().toISOString(),
      });

      const results = await backend.search('weather');
      expect(results).toHaveLength(2);
    });

    it('returns empty when no match', async () => {
      const backend = new InMemoryBackend();
      await backend.store('s1', {
        role: 'user',
        content: 'Hello world',
        timestamp: new Date().toISOString(),
      });

      const results = await backend.search('nonexistent');
      expect(results).toEqual([]);
    });
  });
});
