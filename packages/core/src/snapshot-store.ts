/**
 * SnapshotStore - persistent storage for file system snapshots
 *
 * Mirrors checkpoint-store.ts patterns for consistency.
 */

import type { SnapshotStore, Snapshot } from '@primo-ai/sdk';
import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * In-memory snapshot store for testing and ephemeral use cases.
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private store = new Map<string, Snapshot>();

  async save(snapshot: Snapshot): Promise<void> {
    this.store.set(snapshot.id, snapshot);
  }

  async load(snapshotId: string): Promise<Snapshot | undefined> {
    return this.store.get(snapshotId);
  }

  async delete(snapshotId: string): Promise<void> {
    this.store.delete(snapshotId);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

/**
 * JSONL-backed snapshot store for persistence.
 *
 * File format: one JSON object per snapshot file
 * { id, createdAt, files: [...], metadata }
 */
export class JsonlSnapshotStore implements SnapshotStore {
  constructor(private dir: string) {}

  private validateId(id: string): void {
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error(`Invalid snapshotId: ${id}`);
    }
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async save(snapshot: Snapshot): Promise<void> {
    this.validateId(snapshot.id);
    await mkdir(this.dir, { recursive: true });
    const target = this.path(snapshot.id);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
    await rename(tmp, target);
  }

  async load(snapshotId: string): Promise<Snapshot | undefined> {
    this.validateId(snapshotId);
    try {
      const content = await readFile(this.path(snapshotId), 'utf-8');
      return JSON.parse(content) as Snapshot;
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async delete(snapshotId: string): Promise<void> {
    this.validateId(snapshotId);
    try {
      await rm(this.path(snapshotId));
    } catch (err: unknown) {
      if (!hasCode(err) || err.code !== 'ENOENT') throw err;
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.dir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -5));
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }
}
