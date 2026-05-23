/**
 * PersistentQueue - durable task queue for Runner pattern
 *
 * Supports crash recovery via JSONL persistence.
 * Mirrors checkpoint-store.ts patterns for consistency.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

type TaskStatus = 'pending' | 'in_flight' | 'completed';

export interface QueuedTask<T = unknown> {
  id: string;
  payload: T;
  metadata?: Record<string, unknown>;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueOptions<T = unknown> {
  payload: T;
  metadata?: Record<string, unknown>;
}

function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * In-memory implementation for testing and ephemeral use cases.
 */
export class InMemoryPersistentQueue<T = unknown> {
  private tasks = new Map<string, QueuedTask<T>>();
  private order: string[] = [];
  private idCounter = 0;

  async enqueue(options: EnqueueOptions<T>): Promise<string> {
    const id = `task-${++this.idCounter}`;
    const now = new Date().toISOString();
    const task: QueuedTask<T> = {
      id,
      payload: options.payload,
      metadata: options.metadata,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    this.order.push(id);
    return id;
  }

  async dequeue(): Promise<QueuedTask<T> | undefined> {
    // Find first pending task
    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (task && task.status === 'pending') {
        task.status = 'in_flight';
        task.updatedAt = new Date().toISOString();
        return task;
      }
    }
    return undefined;
  }

  async complete(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.updatedAt = new Date().toISOString();
    }
  }

  async recoverPending(): Promise<QueuedTask<T>[]> {
    // Return tasks that are either:
    // - pending (never dequeued)
    // - in_flight (dequeued but not completed - crash recovery)
    const pending: QueuedTask<T>[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'in_flight') {
        pending.push(task);
      }
    }
    // Sort by creation time
    return pending.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }
}

/**
 * JSONL-backed persistent queue for crash recovery.
 *
 * File format: one JSON object per line
 * {
 *   "id": "task-1",
 *   "payload": {...},
 *   "metadata": {...},
 *   "status": "pending" | "in_flight" | "completed",
 *   "createdAt": "2026-05-21T10:00:00.000Z",
 *   "updatedAt": "2026-05-21T10:00:00.000Z"
 * }
 */
export class JsonlPersistentQueue<T = unknown> {
  private filePath: string;
  private tasks = new Map<string, QueuedTask<T>>();
  private order: string[] = [];
  private loaded = false;
  private idCounter = 0;
  // Write lock queue for concurrent access
  private writeLock: Promise<void> = Promise.resolve();

  constructor(dir: string, filename = 'queue.jsonl') {
    this.filePath = join(dir, filename);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.trim().split('\n');
      let maxId = 0;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const task = JSON.parse(line) as QueuedTask<T>;
          this.tasks.set(task.id, task);
          this.order.push(task.id);

          // Track max ID for counter
          const match = task.id.match(/task-(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxId) maxId = num;
          }
        } catch {
          // Skip malformed lines
        }
      }
      this.idCounter = maxId;
    } catch (err: unknown) {
      if (!hasCode(err) || err.code !== 'ENOENT') throw err;
    }
  }

  private async persist(): Promise<void> {
    // Serialize writes using a promise queue
    const doPersist = async () => {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });

      const lines: string[] = [];
      for (const id of this.order) {
        const task = this.tasks.get(id);
        if (task) {
          lines.push(JSON.stringify(task));
        }
      }

      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, lines.join('\n') + '\n', 'utf-8');
      await this.renameWithRetry(tmp, this.filePath);
    };

    // Chain onto the write lock
    this.writeLock = this.writeLock.then(doPersist, doPersist);
    await this.writeLock;
  }

  /**
   * Rename with retry for Windows EPERM/EPERM race conditions.
   * Windows may briefly hold a file handle after writeFile, causing
   * rename to fail with EPERM. A short delay + retry resolves this.
   */
  private async renameWithRetry(src: string, dest: string, maxRetries = 3): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(src, dest);
        return;
      } catch (err: unknown) {
        if (hasCode(err) && (err.code === 'EPERM' || err.code === 'EACCES') && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  async enqueue(options: EnqueueOptions<T>): Promise<string> {
    await this.ensureLoaded();

    const id = `task-${++this.idCounter}`;
    const now = new Date().toISOString();
    const task: QueuedTask<T> = {
      id,
      payload: options.payload,
      metadata: options.metadata,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, task);
    this.order.push(id);
    await this.persist();

    return id;
  }

  async dequeue(): Promise<QueuedTask<T> | undefined> {
    await this.ensureLoaded();

    // Find first pending task
    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (task && task.status === 'pending') {
        task.status = 'in_flight';
        task.updatedAt = new Date().toISOString();
        await this.persist();
        return task;
      }
    }
    return undefined;
  }

  async complete(taskId: string): Promise<void> {
    await this.ensureLoaded();

    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'completed';
      task.updatedAt = new Date().toISOString();
      await this.persist();
    }
  }

  async recoverPending(): Promise<QueuedTask<T>[]> {
    await this.ensureLoaded();

    const pending: QueuedTask<T>[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'in_flight') {
        pending.push(task);
      }
    }
    return pending.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }
}
