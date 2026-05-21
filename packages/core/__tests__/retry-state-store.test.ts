import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryRetryStateStore, JsonlRetryStateStore } from '../src/retry-state-store.js';
import type { RetryStateStore } from '../src/retry-state-store.js';

const TMP_DIR = join(import.meta.dirname, '__tmp_retry_state_test__');

async function testSuite(name: string, factory: () => RetryStateStore) {
  describe(name, () => {
    let store: RetryStateStore;

    beforeEach(() => {
      store = factory();
    });

    it('increment returns 1 on first call', async () => {
      const v = await store.increment('s1', 'llm');
      expect(v).toBe(1);
    });

    it('increment counts up', async () => {
      await store.increment('s1', 'llm');
      await store.increment('s1', 'llm');
      const v = await store.increment('s1', 'llm');
      expect(v).toBe(3);
    });

    it('different keys are independent', async () => {
      await store.increment('s1', 'llm');
      await store.increment('s1', 'compat');
      expect(await store.get('s1', 'llm')).toBe(1);
      expect(await store.get('s1', 'compat')).toBe(1);
    });

    it('different sessions are independent', async () => {
      await store.increment('s1', 'llm');
      await store.increment('s2', 'llm');
      expect(await store.get('s1', 'llm')).toBe(1);
      expect(await store.get('s2', 'llm')).toBe(1);
    });

    it('get returns 0 for unknown key', async () => {
      expect(await store.get('s1', 'nonexistent')).toBe(0);
    });

    it('reset clears a single key', async () => {
      await store.increment('s1', 'llm');
      await store.increment('s1', 'llm');
      await store.reset('s1', 'llm');
      expect(await store.get('s1', 'llm')).toBe(0);
    });

    it('reset only clears the specified key', async () => {
      await store.increment('s1', 'llm');
      await store.increment('s1', 'compat');
      await store.reset('s1', 'llm');
      expect(await store.get('s1', 'llm')).toBe(0);
      expect(await store.get('s1', 'compat')).toBe(1);
    });

    it('list returns all counts for a session', async () => {
      await store.increment('s1', 'llm');
      await store.increment('s1', 'llm');
      await store.increment('s1', 'compat');
      await store.increment('s2', 'processor');

      const all = await store.list('s1');
      expect(all).toHaveLength(2);
      const llm = all.find((e) => e.key === 'llm');
      expect(llm?.count).toBe(2);
    });

    it('list returns empty for unknown session', async () => {
      const all = await store.list('unknown');
      expect(all).toEqual([]);
    });
  });
}

testSuite('InMemoryRetryStateStore', () => new InMemoryRetryStateStore());

describe('JsonlRetryStateStore', () => {
  beforeEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
    await mkdir(TMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
  });

  testSuite('JsonlRetryStateStore', () => new JsonlRetryStateStore(TMP_DIR));

  it('survives re-instantiation', async () => {
    const a = new JsonlRetryStateStore(TMP_DIR);
    await a.increment('s1', 'llm');
    await a.increment('s1', 'llm');
    await a.increment('s1', 'llm');

    const b = new JsonlRetryStateStore(TMP_DIR);
    expect(await b.get('s1', 'llm')).toBe(3);
  });

  it('rejects path traversal in sessionId', async () => {
    const store = new JsonlRetryStateStore(TMP_DIR);
    await expect(store.increment('../bad', 'key')).rejects.toThrow();
  });
});
