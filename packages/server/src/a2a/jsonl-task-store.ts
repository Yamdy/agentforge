import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InMemoryTaskStore } from './task-store.js';
import type { A2ATask, A2ATaskState, A2AMessage, A2AArtifact } from './types.js';

interface TaskEvent {
  op: 'create' | 'updateStatus' | 'addArtifact' | 'addMessage' | 'cancel';
  [key: string]: unknown;
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
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        await writeFile(tmp, line, 'utf-8');
        await rename(tmp, target);
      } else {
        throw err;
      }
    }
  }

  async create(contextId: string): Promise<A2ATask> {
    const task = await super.create(contextId);
    await this.append(task.id, { op: 'create', task: { ...task } });
    return task;
  }

  async updateStatus(id: string, state: A2ATaskState): Promise<A2ATask> {
    const task = await super.updateStatus(id, state);
    await this.append(id, { op: 'updateStatus', state, timestamp: task.status.timestamp });
    return task;
  }

  async addMessage(id: string, message: A2AMessage): Promise<void> {
    await super.addMessage(id, message);
    await this.append(id, { op: 'addMessage', message });
  }

  async addArtifact(id: string, artifact: A2AArtifact): Promise<void> {
    await super.addArtifact(id, artifact);
    await this.append(id, { op: 'addArtifact', artifact });
  }

  async cancel(id: string): Promise<A2ATask> {
    const task = await super.cancel(id);
    await this.append(id, { op: 'cancel', timestamp: task.status.timestamp });
    return task;
  }

  async restore(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (err: any) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const taskId = file.slice(0, -6);
      const content = await readFile(join(this.dir, file), 'utf-8');

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event: TaskEvent = JSON.parse(trimmed);

        let entry = (this as any).entries.get(taskId) as { task: A2ATask; createdAt: number } | undefined;

        switch (event.op) {
          case 'create': {
            const task = (event as any).task as A2ATask;
            entry = { task: { ...task, history: task.history ?? [], artifacts: task.artifacts ?? [] }, createdAt: Date.now() };
            (this as any).entries.set(taskId, entry);
            (this as any).insertionOrder.push(taskId);
            const counter = (this as any).counter as number;
            const idNum = parseInt(taskId.replace('task-', ''), 10);
            if (!isNaN(idNum) && idNum > counter) {
              (this as any).counter = idNum;
            }
            break;
          }
          case 'updateStatus': {
            if (entry) entry.task.status = { ...entry.task.status, state: event.state, timestamp: (event as any).timestamp };
            break;
          }
          case 'addArtifact': {
            if (entry) { if (!entry.task.artifacts) entry.task.artifacts = []; entry.task.artifacts.push((event as any).artifact); }
            break;
          }
          case 'addMessage': {
            if (entry) { if (!entry.task.history) entry.task.history = []; entry.task.history.push((event as any).message); }
            break;
          }
          case 'cancel': {
            if (entry) entry.task.status = { ...entry.task.status, state: 'canceled', timestamp: (event as any).timestamp };
            break;
          }
        }
      }
    }
  }
}
