import { describe, it, expect } from 'vitest';
import { InMemoryStore } from '@primo-ai/core';
import { CoreMemoryBackend } from '../src/memory/core-adapter.js';

function makeEntry(overrides?: Partial<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }>) {
  return {
    role: (overrides?.role ?? 'user') as 'user' | 'assistant' | 'system',
    content: overrides?.content ?? 'Hello agent',
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
  };
}

describe('CoreMemoryBackend', () => {
  describe('store + retrieve', () => {
    it('stores and retrieves a memory entry for a session', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      const entry = makeEntry();

      await backend.store('session-a', entry);
      const results = await backend.retrieve('session-a');

      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('user');
      expect(results[0].content).toBe('Hello agent');
    });

    it('returns empty array for unknown session', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      const results = await backend.retrieve('no-such-session');
      expect(results).toEqual([]);
    });

    it('limits results with query.limit (returns most recent)', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      for (let i = 0; i < 5; i++) {
        await backend.store('s1', makeEntry({
          content: `msg-${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        }));
      }
      const results = await backend.retrieve('s1', { limit: 2 });
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('msg-4');
      expect(results[1].content).toBe('msg-3');
    });

    it('filters results with query.since', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      const t0 = new Date('2026-01-01T00:00:00Z').toISOString();
      const t1 = new Date('2026-01-02T00:00:00Z').toISOString();
      const t2 = new Date('2026-01-03T00:00:00Z').toISOString();
      await backend.store('s1', makeEntry({ content: 'old', timestamp: t0 }));
      await backend.store('s1', makeEntry({ content: 'mid', timestamp: t1 }));
      await backend.store('s1', makeEntry({ content: 'new', timestamp: t2 }));

      // since is exclusive (>), t1 itself is excluded; use t0 to get mid+new
      const results = await backend.retrieve('s1', { since: t0 });
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.content)).toEqual(['new', 'mid']);
    });
  });

  describe('search', () => {
    it('searches across all sessions by content substring', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      await backend.store('s1', makeEntry({ role: 'user', content: 'What is the weather today?' }));
      await backend.store('s2', makeEntry({ role: 'assistant', content: 'The weather is sunny.' }));
      await backend.store('s3', makeEntry({ role: 'user', content: 'Nothing related' }));

      const results = await backend.search('weather');
      expect(results).toHaveLength(2);
    });

    it('returns empty when no match', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      await backend.store('s1', makeEntry({ content: 'Hello world' }));

      const results = await backend.search('nonexistent');
      expect(results).toEqual([]);
    });

    it('respects options.limit', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      await backend.store('s1', makeEntry({ content: 'alpha beta' }));
      await backend.store('s2', makeEntry({ content: 'alpha gamma' }));
      await backend.store('s3', makeEntry({ content: 'alpha delta' }));

      const results = await backend.search('alpha', { limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('deleteEntries', () => {
    it('deletes entries matching the predicate within a session', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      const t0 = new Date('2026-01-01T00:00:00Z').toISOString();
      const t1 = new Date('2026-01-02T00:00:00Z').toISOString();
      const t2 = new Date('2026-01-03T00:00:00Z').toISOString();
      await backend.store('s1', makeEntry({ role: 'user', content: 'keep me', timestamp: t0 }));
      await backend.store('s1', makeEntry({ role: 'user', content: 'delete me', timestamp: t1 }));
      await backend.store('s1', makeEntry({ role: 'assistant', content: 'also keep', timestamp: t2 }));

      const count = await backend.deleteEntries('s1', (e) => e.content.includes('delete'));
      expect(count).toBe(1);

      const remaining = await backend.retrieve('s1');
      expect(remaining).toHaveLength(2);
      expect(remaining.map((r) => r.content)).toEqual(['also keep', 'keep me']);
    });

    it('returns 0 for unknown session', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      const count = await backend.deleteEntries('no-such', () => true);
      expect(count).toBe(0);
    });
  });

  describe('deleteEntriesGlobally', () => {
    it('deletes matching entries across all sessions', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      await backend.store('s1', makeEntry({ content: 'important note' }));
      await backend.store('s2', makeEntry({ content: 'important reminder' }));
      await backend.store('s3', makeEntry({ content: 'casual chat' }));

      const count = await backend.deleteEntriesGlobally!((e) => e.content.includes('important'));
      expect(count).toBe(2);

      const r1 = await backend.retrieve('s1');
      const r2 = await backend.retrieve('s2');
      const r3 = await backend.retrieve('s3');
      expect(r1).toHaveLength(0);
      expect(r2).toHaveLength(0);
      expect(r3).toHaveLength(1);
    });

    it('returns 0 when no match', async () => {
      const storage = new InMemoryStore();
      const backend = new CoreMemoryBackend({ storage });
      await backend.store('s1', makeEntry({ content: 'hello' }));

      const count = await backend.deleteEntriesGlobally!((e) => e.content.includes('nonexistent'));
      expect(count).toBe(0);
    });
  });
});
