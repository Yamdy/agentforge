import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryTaskStore } from './task-store.js';
import type { A2ATask, A2ATaskState, A2AMessage, A2AArtifact } from './types.js';

type TaskEvent =
  | { op: 'create'; task: A2ATask }
  | { op: 'updateStatus'; state: A2ATaskState; timestamp: string }
  | { op: 'addArtifact'; artifact: A2AArtifact }
  | { op: 'addMessage'; message: A2AMessage }
  | { op: 'cancel'; timestamp: string };

interface StoreInternals {
  entries: Map<string, { task: A2ATask; createdAt: number }>;
  insertionOrder: string[];
  counter: number;
}

function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * Validate a taskId is safe for use as a filename component.
 * Rejects path traversal, special characters, and null bytes.
 */
function validateTaskId(taskId: string): void {
  if (taskId.includes('..')) {
    throw new Error(`Invalid taskId: path traversal not allowed`);
  }
  if (taskId.includes('\0')) {
    throw new Error(`Invalid taskId: null bytes not allowed`);
  }
  if (/[<>:"|?*\\/]/.test(taskId)) {
    throw new Error(`Invalid taskId: special characters not allowed`);
  }
}

export class JsonlTaskStore extends InMemoryTaskStore {
  private dir: string;

  constructor(dir: string) {
    super();
    this.dir = dir;
  }

  private filePath(taskId: string): string {
    return join(this.dir, `${taskId}.jsonl`);
  }

  private async append(taskId: string, event: TaskEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.filePath(taskId);
    const tmp = `${target}.tmp`;
    const line = JSON.stringify(event) + '\n';

    try {
      const existing = await readFile(target, 'utf-8');
      await writeFile(tmp, existing + line, 'utf-8');
      await rename(tmp, target);
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') {
        await writeFile(tmp, line, 'utf-8');
        await rename(tmp, target);
      } else {
        throw err;
      }
    }
  }

  async get(id: string): Promise<A2ATask | undefined> {
    validateTaskId(id);
    return super.get(id);
  }

  async create(contextId: string): Promise<A2ATask> {
    const task = await super.create(contextId);
    await this.append(task.id, { op: 'create', task: { ...task } });
    return task;
  }

  async updateStatus(id: string, state: A2ATaskState): Promise<A2ATask> {
    validateTaskId(id);
    const task = await super.updateStatus(id, state);
    await this.append(id, { op: 'updateStatus', state, timestamp: task.status.timestamp });
    return task;
  }

  async addMessage(id: string, message: A2AMessage): Promise<void> {
    validateTaskId(id);
    await super.addMessage(id, message);
    await this.append(id, { op: 'addMessage', message });
  }

  async addArtifact(id: string, artifact: A2AArtifact): Promise<void> {
    validateTaskId(id);
    await super.addArtifact(id, artifact);
    await this.append(id, { op: 'addArtifact', artifact });
  }

  async cancel(id: string): Promise<A2ATask> {
    validateTaskId(id);
    const task = await super.cancel(id);
    await this.append(id, { op: 'cancel', timestamp: task.status.timestamp });
    return task;
  }

  async restore(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return;
      throw err;
    }

    const internals = this as unknown as StoreInternals;

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const taskId = file.slice(0, -6);
      const content = await readFile(join(this.dir, file), 'utf-8');

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event: TaskEvent = JSON.parse(trimmed);

        let entry = internals.entries.get(taskId);

        switch (event.op) {
          case 'create': {
            const task = event.task;
            entry = { task: { ...task, history: task.history ?? [], artifacts: task.artifacts ?? [] }, createdAt: Date.now() };
            internals.entries.set(taskId, entry);
            internals.insertionOrder.push(taskId);
            const counter = internals.counter;
            const idNum = parseInt(taskId.replace('task-', ''), 10);
            if (!isNaN(idNum) && idNum > counter) {
              internals.counter = idNum;
            }
            break;
          }
          case 'updateStatus': {
            if (entry) entry.task.status = { ...entry.task.status, state: event.state, timestamp: event.timestamp };
            break;
          }
          case 'addArtifact': {
            if (entry) { if (!entry.task.artifacts) entry.task.artifacts = []; entry.task.artifacts.push(event.artifact); }
            break;
          }
          case 'addMessage': {
            if (entry) { if (!entry.task.history) entry.task.history = []; entry.task.history.push(event.message); }
            break;
          }
          case 'cancel': {
            if (entry) entry.task.status = { ...entry.task.status, state: 'canceled', timestamp: event.timestamp };
            break;
          }
        }
      }
    }
  }
}
