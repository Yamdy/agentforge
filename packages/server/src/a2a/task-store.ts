import type { A2ATask, A2ATaskState, A2AMessage, A2AArtifact } from './types.js';
import { isValidTransition, isTerminal } from './types.js';

export interface InMemoryTaskStoreOptions {
  maxEntries?: number;
  ttlMs?: number;
}

interface TaskEntry {
  task: A2ATask;
  createdAt: number;
}

export class InMemoryTaskStore {
  private entries = new Map<string, TaskEntry>();
  private insertionOrder: string[] = [];
  private counter = 0;
  private maxEntries?: number;
  private ttlMs?: number;

  constructor(options?: InMemoryTaskStoreOptions) {
    this.maxEntries = options?.maxEntries;
    this.ttlMs = options?.ttlMs;
  }

  async create(contextId: string): Promise<A2ATask> {
    const id = `task-${++this.counter}`;
    const now = Date.now();
    const task: A2ATask = {
      id,
      contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [],
      artifacts: [],
    };
    this.entries.set(id, { task, createdAt: now });
    this.insertionOrder.push(id);
    this.evictIfNeeded();
    return { ...task };
  }

  async get(id: string): Promise<A2ATask | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const task = entry.task;
    return { ...task, history: [...(task.history ?? [])], artifacts: [...(task.artifacts ?? [])] };
  }

  async updateStatus(id: string, state: A2ATaskState): Promise<A2ATask> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Task not found: ${id}`);
    if (!isValidTransition(entry.task.status.state, state)) {
      throw new Error(`Invalid transition: ${entry.task.status.state} → ${state}`);
    }
    entry.task.status = { ...entry.task.status, state, timestamp: new Date().toISOString() };
    return { ...entry.task, history: [...(entry.task.history ?? [])], artifacts: [...(entry.task.artifacts ?? [])] };
  }

  async addMessage(id: string, message: A2AMessage): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Task not found: ${id}`);
    if (!entry.task.history) entry.task.history = [];
    entry.task.history.push(message);
  }

  async addArtifact(id: string, artifact: A2AArtifact): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Task not found: ${id}`);
    if (!entry.task.artifacts) entry.task.artifacts = [];
    entry.task.artifacts.push(artifact);
  }

  async cancel(id: string): Promise<A2ATask> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Task not found: ${id}`);
    if (isTerminal(entry.task.status.state)) {
      throw new Error(`Cannot cancel task in terminal state: ${entry.task.status.state}`);
    }
    entry.task.status = { ...entry.task.status, state: 'canceled', timestamp: new Date().toISOString() };
    return { ...entry.task, history: [...(entry.task.history ?? [])], artifacts: [...(entry.task.artifacts ?? [])] };
  }

  async listByContext(contextId: string): Promise<A2ATask[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.task.contextId === contextId)
      .map((e) => e.task);
  }

  /**
   * Remove expired terminal tasks (past TTL). Non-terminal tasks are never removed.
   */
  cleanup(): void {
    if (!this.ttlMs) return;
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (isTerminal(entry.task.status.state) && (now - entry.createdAt) > this.ttlMs!) {
        this.entries.delete(id);
        this.insertionOrder = this.insertionOrder.filter((oid) => oid !== id);
      }
    }
  }

  private evictIfNeeded(): void {
    if (!this.maxEntries) return;

    while (this.entries.size > this.maxEntries) {
      // Find the oldest terminal task to evict
      let evicted = false;
      for (const id of this.insertionOrder) {
        const entry = this.entries.get(id);
        if (entry && isTerminal(entry.task.status.state)) {
          this.entries.delete(id);
          this.insertionOrder = this.insertionOrder.filter((oid) => oid !== id);
          evicted = true;
          break;
        }
      }
      // If no terminal task found, stop (don't evict non-terminal tasks)
      if (!evicted) break;
    }
  }
}
