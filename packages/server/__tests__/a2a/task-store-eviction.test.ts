import { describe, it, expect, vi } from 'vitest';
import { InMemoryTaskStore } from '../../src/a2a/task-store.js';

describe('InMemoryTaskStore eviction and TTL', () => {
  // Helper: create task and advance to terminal state
  async function createTerminalTask(
    store: InMemoryTaskStore,
    contextId = 'ctx',
  ) {
    const task = await store.create(contextId);
    await store.updateStatus(task.id, 'working');
    await store.updateStatus(task.id, 'completed');
    return task;
  }

  // 1. maxEntries evicts oldest terminal task when cap exceeded
  it('evicts oldest terminal task when maxEntries exceeded', async () => {
    const store = new InMemoryTaskStore({ maxEntries: 3 });

    const t1 = await createTerminalTask(store);
    const t2 = await createTerminalTask(store);
    const t3 = await createTerminalTask(store);

    // Store is at capacity with 3 terminal tasks
    expect(await store.get(t1.id)).toBeDefined();
    expect(await store.get(t2.id)).toBeDefined();
    expect(await store.get(t3.id)).toBeDefined();

    // Creating a 4th should evict the oldest (t1)
    const t4 = await createTerminalTask(store);
    expect(await store.get(t1.id)).toBeUndefined();
    expect(await store.get(t2.id)).toBeDefined();
    expect(await store.get(t3.id)).toBeDefined();
    expect(await store.get(t4.id)).toBeDefined();
  });

  // 2. Tasks in working/submitted state are NOT evicted
  it('does not evict non-terminal (working) tasks', async () => {
    const store = new InMemoryTaskStore({ maxEntries: 2 });

    const t1 = await createTerminalTask(store); // terminal
    const t2 = await store.create('ctx'); // submitted (non-terminal)
    const t3 = await createTerminalTask(store); // terminal — triggers eviction

    // t1 should be evicted (oldest terminal), t2 must survive
    expect(await store.get(t1.id)).toBeUndefined();
    expect(await store.get(t2.id)).toBeDefined();
    expect(await store.get(t3.id)).toBeDefined();
  });

  it('does not evict working tasks even if they are oldest', async () => {
    const store = new InMemoryTaskStore({ maxEntries: 2 });

    const t1 = await store.create('ctx'); // stays in submitted
    const t2 = await createTerminalTask(store);
    const t3 = await createTerminalTask(store); // triggers eviction

    // t1 is oldest but non-terminal, so t2 (terminal) gets evicted instead
    expect(await store.get(t1.id)).toBeDefined();
    expect(await store.get(t2.id)).toBeUndefined();
    expect(await store.get(t3.id)).toBeDefined();
  });

  // 3. cleanup() removes expired tasks (past TTL)
  it('cleanup() removes tasks past TTL', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryTaskStore({ ttlMs: 1000 });

      const t1 = await createTerminalTask(store);
      vi.advanceTimersByTime(500);
      const t2 = await createTerminalTask(store);

      // t1 is now 500ms old, t2 is fresh — nothing expired yet
      store.cleanup();
      expect(await store.get(t1.id)).toBeDefined();
      expect(await store.get(t2.id)).toBeDefined();

      // Advance past TTL for t1
      vi.advanceTimersByTime(600); // t1 is now 1100ms old
      store.cleanup();
      expect(await store.get(t1.id)).toBeUndefined();
      expect(await store.get(t2.id)).toBeDefined(); // t2 only 600ms old
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanup() does not remove non-terminal tasks even past TTL', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryTaskStore({ ttlMs: 500 });

      const t1 = await store.create('ctx'); // submitted — non-terminal
      vi.advanceTimersByTime(1000); // past TTL

      store.cleanup();
      // Non-terminal task should survive even past TTL
      expect(await store.get(t1.id)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  // 4. Default constructor works without options
  it('default constructor works without options', async () => {
    const store = new InMemoryTaskStore();

    // Create more than 3 tasks — should not evict (no maxEntries)
    const tasks = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(await createTerminalTask(store, `ctx-${i}`));
    }

    // All tasks should still be present
    for (const t of tasks) {
      expect(await store.get(t.id)).toBeDefined();
    }
  });

  it('cleanup() on store without ttlMs is a no-op', async () => {
    const store = new InMemoryTaskStore();
    const t1 = await createTerminalTask(store);
    store.cleanup();
    expect(await store.get(t1.id)).toBeDefined();
  });
});
