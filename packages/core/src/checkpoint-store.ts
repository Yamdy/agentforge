import type { CheckpointStore } from '@primo-ai/sdk';
import { readFile, writeFile, mkdir, rm, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

export class InMemoryCheckpointStore<T = unknown> implements CheckpointStore<T> {
  private store = new Map<string, T>();

  async save(sessionId: string, data: T): Promise<void> {
    this.store.set(sessionId, data);
  }

  async load(sessionId: string): Promise<T | undefined> {
    return this.store.get(sessionId);
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

export class JsonlCheckpointStore<T = unknown> implements CheckpointStore<T> {
  constructor(private dir: string) {}

  private validateSessionId(sessionId: string): void {
    if (sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }
  }

  private path(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  async save(sessionId: string, data: T): Promise<void> {
    this.validateSessionId(sessionId);
    await mkdir(this.dir, { recursive: true });
    const target = this.path(sessionId);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(data) + '\n', 'utf-8');
    await rename(tmp, target);
  }

  async load(sessionId: string): Promise<T | undefined> {
    this.validateSessionId(sessionId);
    try {
      const content = await readFile(this.path(sessionId), 'utf-8');
      const line = content.trim();
      if (!line) return undefined;
      return JSON.parse(line) as T;
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async delete(sessionId: string): Promise<void> {
    this.validateSessionId(sessionId);
    try {
      await rm(this.path(sessionId));
    } catch (err: unknown) {
      if (!hasCode(err) || err.code !== 'ENOENT') throw err;
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.dir);
      return files.filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6));
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }
}
