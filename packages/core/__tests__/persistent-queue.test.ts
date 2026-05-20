import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryPersistentQueue, JsonlPersistentQueue } from '../src/task-queue/persistent-queue.js';
import type { QueuedTask } from '../src/task-queue/persistent-queue.js';

// Type alias to help TypeScript infer types correctly
type Task = QueuedTask<string>;

describe('PersistentQueue', () => {
  describe('InMemoryPersistentQueue', () => {
    let queue: InMemoryPersistentQueue<string>;

    beforeEach(() => {
      queue = new InMemoryPersistentQueue();
    });

    it('starts empty', async () => {
      const task = await queue.dequeue();
      expect(task).toBeUndefined();
    });

    it('enqueues and dequeues tasks in order', async () => {
      const id1 = await queue.enqueue({ payload: 'task1' });
      const id2 = await queue.enqueue({ payload: 'task2' });

      const task1 = await queue.dequeue();
      expect(task1?.id).toBe(id1);
      expect(task1?.payload).toBe('task1');

      const task2 = await queue.dequeue();
      expect(task2?.id).toBe(id2);
      expect(task2?.payload).toBe('task2');
    });

    it('returns undefined when dequeuing from empty queue', async () => {
      await queue.enqueue({ payload: 'task' });
      await queue.dequeue();
      const task = await queue.dequeue();
      expect(task).toBeUndefined();
    });

    it('marks task as completed', async () => {
      const id = await queue.enqueue({ payload: 'task' });
      const task = await queue.dequeue();
      expect(task?.id).toBe(id);

      await queue.complete(id);
      // Completed tasks should not be recovered
      const pending = await queue.recoverPending();
      expect(pending).toHaveLength(0);
    });

    it('recovers pending tasks (dequeued but not completed)', async () => {
      const id1 = await queue.enqueue({ payload: 'task1' });
      const id2 = await queue.enqueue({ payload: 'task2' });

      // Dequeue first task (simulates crash before completion)
      await queue.dequeue();

      const pending: Task[] = await queue.recoverPending();
      // Both id1 (in_flight) and id2 (pending) should be recovered
      expect(pending).toHaveLength(2);
      expect(pending.find((t: Task) => t.id === id1)?.status).toBe('in_flight');
      expect(pending.find((t: Task) => t.id === id2)?.status).toBe('pending');
    });

    it('generates unique IDs', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = await queue.enqueue({ payload: `task${i}` });
        ids.add(id);
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('JsonlPersistentQueue', () => {
    let queue: JsonlPersistentQueue<string>;
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'queue-'));
      queue = new JsonlPersistentQueue(tempDir);
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('persists tasks across instances', async () => {
      const id = await queue.enqueue({ payload: 'persistent-task' });

      // Create new instance with same directory
      const queue2 = new JsonlPersistentQueue<string>(tempDir);
      const task = await queue2.dequeue();
      expect(task?.id).toBe(id);
      expect(task?.payload).toBe('persistent-task');
    });

    it('recovers pending tasks after simulated crash', async () => {
      const id1 = await queue.enqueue({ payload: 'task1' });
      const id2 = await queue.enqueue({ payload: 'task2' });

      // Dequeue first task but don't complete (simulates crash)
      await queue.dequeue();

      // New instance should recover both: id1 (in-flight) and id2 (queued)
      const queue2 = new JsonlPersistentQueue<string>(tempDir);
      const pending: Task[] = await queue2.recoverPending();

      // id1 was dequeued but not completed, should be recovered
      // id2 was never dequeued, should also be recovered
      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending.find((t: Task) => t.id === id1)).toBeDefined();
    });

    it('persists completion status', async () => {
      const id = await queue.enqueue({ payload: 'task' });
      await queue.dequeue();
      await queue.complete(id);

      // New instance should not recover completed task
      const queue2 = new JsonlPersistentQueue<string>(tempDir);
      const pending: Task[] = await queue2.recoverPending();
      expect(pending).toHaveLength(0);
    });

    it('handles concurrent enqueue operations', async () => {
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(queue.enqueue({ payload: `task${i}` }));
      }
      const ids = await Promise.all(promises);
      expect(new Set(ids).size).toBe(50);
    });

    it('stores metadata with tasks', async () => {
      const id = await queue.enqueue({
        payload: 'task-with-meta',
        metadata: { priority: 10, agentId: 'agent-1' },
      });

      const task = await queue.dequeue();
      expect(task?.metadata?.priority).toBe(10);
      expect(task?.metadata?.agentId).toBe('agent-1');
    });
  });
});
