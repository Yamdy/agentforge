import type { EvictionStorage } from '@agentforge/sdk';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface FilesystemEvictionStorageOptions {
  /** Time-to-live in milliseconds. Entries older than this are treated as expired on read. */
  ttlMs?: number;
}

/**
 * Validate a sessionId is safe for use as a filename component.
 * Rejects path traversal, special characters, and null bytes.
 */
function validateSessionId(sessionId: string): void {
  if (sessionId.includes('..')) {
    throw new Error(`Invalid sessionId: path traversal not allowed`);
  }
  if (sessionId.includes('\0')) {
    throw new Error(`Invalid sessionId: null bytes not allowed`);
  }
  if (/[<>:"|?*\\/]/.test(sessionId)) {
    throw new Error(`Invalid sessionId: special characters not allowed`);
  }
}

/**
 * Validate a key for safety. Same rules as sessionId.
 */
function validateKey(key: string): void {
  if (key.includes('..')) {
    throw new Error(`Invalid key: path traversal not allowed`);
  }
  if (key.includes('\0')) {
    throw new Error(`Invalid key: null bytes not allowed`);
  }
}

/**
 * Validate a reference for safety.
 */
function validateReference(reference: string): void {
  if (reference.includes('..')) {
    throw new Error(`Invalid reference: path traversal not allowed`);
  }
  if (reference.includes('\0')) {
    throw new Error(`Invalid reference: null bytes not allowed`);
  }
}

function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

interface Entry {
  key: string;
  content: unknown;
  storedAt: number;
}

/**
 * Filesystem-backed implementation of EvictionStorage.
 *
 * Each session gets a single JSONL file (`{sessionId}.jsonl`) in the configured
 * directory. Every `store()` call appends a JSON line. The `reference` returned
 * is `{sessionId}:{key}:{seq}` — the file is rewritten in full so each key
 * appears only once (last-write-wins).
 *
 * Extended API beyond `EvictionStorage`:
 * - `delete(sessionId)` — remove all entries for a session (deletes the file)
 * - `list()` — enumerate all session IDs present on disk
 */
export class FilesystemEvictionStorage implements EvictionStorage {
  private readonly dir: string;
  private readonly ttlMs: number | undefined;
  /** In-memory cache: sessionId -> entries keyed by ref */
  private cache = new Map<string, Map<string, Entry>>();
  /** Tracks which sessions have been loaded from disk */
  private loaded = new Set<string>();

  constructor(dir: string, options?: FilesystemEvictionStorageOptions) {
    this.dir = dir;
    this.ttlMs = options?.ttlMs;
  }

  // ---------------------------------------------------------------------------
  // EvictionStorage interface
  // ---------------------------------------------------------------------------

  async store(sessionId: string, key: string, content: unknown): Promise<string> {
    validateSessionId(sessionId);
    validateKey(key);

    await this.ensureLoaded(sessionId);

    const seq = (this.cache.get(sessionId)?.size ?? 0) + 1;
    const ref = `${sessionId}:${key}:${seq}`;
    const entry: Entry = { key, content, storedAt: Date.now() };

    let sessionMap = this.cache.get(sessionId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.cache.set(sessionId, sessionMap);
    }
    sessionMap.set(ref, entry);

    await this.persistSession(sessionId);
    return ref;
  }

  async retrieve(sessionId: string, reference: string): Promise<unknown> {
    validateReference(reference);

    await this.ensureLoaded(sessionId);

    const sessionMap = this.cache.get(sessionId);
    if (!sessionMap) return undefined;

    const entry = sessionMap.get(reference);
    if (!entry) return undefined;

    // Check TTL expiration
    if (this.ttlMs !== undefined && Date.now() - entry.storedAt > this.ttlMs) {
      return undefined;
    }

    return entry.content;
  }

  // ---------------------------------------------------------------------------
  // Extended API
  // ---------------------------------------------------------------------------

  /**
   * Delete all eviction data for a given session.
   */
  async delete(sessionId: string): Promise<void> {
    validateSessionId(sessionId);

    // Remove from memory
    this.cache.delete(sessionId);
    this.loaded.delete(sessionId);

    // Remove from disk
    const filePath = this.sessionFilePath(sessionId);
    try {
      await unlink(filePath);
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * List all session IDs that have eviction data on disk.
   */
  async list(): Promise<string[]> {
    let files: string[];
    try {
      await mkdir(this.dir, { recursive: true });
      files = await readdir(this.dir);
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return [];
      throw err;
    }

    const sessionIds: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.slice(0, -6); // strip .jsonl
      sessionIds.push(sessionId);
    }
    return sessionIds;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private sessionFilePath(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  /**
   * Ensure a session's data is loaded from disk into the cache.
   * No-op if already loaded.
   */
  private async ensureLoaded(sessionId: string): Promise<void> {
    if (this.loaded.has(sessionId)) return;
    this.loaded.add(sessionId);

    const filePath = this.sessionFilePath(sessionId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') {
        // No file yet — that's fine
        return;
      }
      throw err;
    }

    const sessionMap = new Map<string, Entry>();

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { ref: string; entry: Entry };
        sessionMap.set(parsed.ref, parsed.entry);
      } catch {
        // Malformed line — skip
      }
    }

    if (sessionMap.size > 0) {
      this.cache.set(sessionId, sessionMap);
    }
  }

  /**
   * Write the current state of a session to disk as JSONL.
   * Uses atomic write (tmp + rename) to avoid corruption.
   */
  private async persistSession(sessionId: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });

    const sessionMap = this.cache.get(sessionId);
    if (!sessionMap || sessionMap.size === 0) return;

    const lines: string[] = [];
    for (const [ref, entry] of sessionMap) {
      lines.push(JSON.stringify({ ref, entry }));
    }

    const target = this.sessionFilePath(sessionId);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, lines.join('\n') + '\n', 'utf-8');
    await rename(tmp, target);
  }
}
