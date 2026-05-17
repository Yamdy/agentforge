import type { EvictionStorage } from '@agentforge/sdk';
import { mkdir, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface FilesystemEvictionStorageOptions {
  ttlMs?: number;
}

interface StoredEntry {
  content: unknown;
  storedAt: number;
}

export class FilesystemEvictionStorage implements EvictionStorage {
  private baseDir: string;
  private ttlMs: number | undefined;

  constructor(baseDir: string, options?: FilesystemEvictionStorageOptions) {
    this.baseDir = baseDir;
    this.ttlMs = options?.ttlMs;
  }

  async store(sessionId: string, key: string, content: unknown): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    const ref = `${sessionId}:${key}:${randomUUID()}`;
    const entry: StoredEntry = { content, storedAt: Date.now() };
    const filePath = this.refToPath(ref);
    await writeFile(filePath, JSON.stringify(entry), 'utf-8');
    return ref;
  }

  async retrieve(_sessionId: string, reference: string): Promise<unknown> {
    const filePath = this.refToPath(reference);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const entry: StoredEntry = JSON.parse(raw);

      // Check TTL expiration
      if (this.ttlMs !== undefined) {
        const age = Date.now() - entry.storedAt;
        if (age > this.ttlMs) {
          return undefined;
        }
      }

      return entry.content;
    } catch {
      return undefined;
    }
  }

  async delete(_sessionId: string, reference: string): Promise<boolean> {
    const filePath = this.refToPath(reference);
    try {
      await unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<number> {
    if (this.ttlMs === undefined) return 0;

    let cleaned = 0;
    try {
      const files = await readdir(this.baseDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = join(this.baseDir, file);
        try {
          const raw = await readFile(filePath, 'utf-8');
          const entry: StoredEntry = JSON.parse(raw);
          const age = now - entry.storedAt;
          if (age > this.ttlMs!) {
            await unlink(filePath);
            cleaned++;
          }
        } catch {
          // Malformed or locked file — skip
        }
      }
    } catch {
      // Directory may not exist
    }
    return cleaned;
  }

  private refToPath(ref: string): string {
    // Use a filesystem-safe encoding of the reference
    const safe = ref.replace(/[:/\\]/g, '_');
    return join(this.baseDir, `${safe}.json`);
  }
}
