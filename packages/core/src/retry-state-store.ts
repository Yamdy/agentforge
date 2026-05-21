import { readFile, appendFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export interface RetryStateEntry {
  key: string;
  count: number;
}

export interface RetryStateStore {
  increment(sessionId: string, key: string): Promise<number>;
  get(sessionId: string, key: string): Promise<number>;
  reset(sessionId: string, key: string): Promise<void>;
  list(sessionId: string): Promise<RetryStateEntry[]>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export class InMemoryRetryStateStore implements RetryStateStore {
  private store = new Map<string, Map<string, number>>();

  private keyMap(sessionId: string): Map<string, number> {
    let m = this.store.get(sessionId);
    if (!m) {
      m = new Map();
      this.store.set(sessionId, m);
    }
    return m;
  }

  async increment(sessionId: string, key: string): Promise<number> {
    const m = this.keyMap(sessionId);
    const next = (m.get(key) ?? 0) + 1;
    m.set(key, next);
    return next;
  }

  async get(sessionId: string, key: string): Promise<number> {
    return this.store.get(sessionId)?.get(key) ?? 0;
  }

  async reset(sessionId: string, key: string): Promise<void> {
    this.store.get(sessionId)?.delete(key);
  }

  async list(sessionId: string): Promise<RetryStateEntry[]> {
    const m = this.store.get(sessionId);
    if (!m) return [];
    return [...m.entries()].map(([key, count]) => ({ key, count }));
  }
}

// ---------------------------------------------------------------------------
// JSONL file-based (disk-persistent, survives process restart)
// ---------------------------------------------------------------------------

interface RetryStateEvent {
  sessionId: string;
  key: string;
  count: number;
  timestamp: string;
}

function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

export class JsonlRetryStateStore implements RetryStateStore {
  constructor(private dir: string) {}

  private validate(sessionId: string): void {
    if (sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
      throw new Error(`Invalid sessionId: ${sessionId}`);
    }
  }

  private filepath(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  private async readEvents(sessionId: string): Promise<RetryStateEvent[]> {
    try {
      const content = await readFile(this.filepath(sessionId), 'utf-8');
      return content.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as RetryStateEvent);
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async increment(sessionId: string, key: string): Promise<number> {
    this.validate(sessionId);
    const events = await this.readEvents(sessionId);
    let last = 0;
    for (const e of events) {
      if (e.key === key) last = e.count;
    }
    const next = last + 1;
    const event: RetryStateEvent = { sessionId, key, count: next, timestamp: new Date().toISOString() };
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.filepath(sessionId), JSON.stringify(event) + '\n', 'utf-8');
    return next;
  }

  async get(sessionId: string, key: string): Promise<number> {
    this.validate(sessionId);
    const events = await this.readEvents(sessionId);
    let count = 0;
    for (const e of events) {
      if (e.key === key) count = e.count;
    }
    return count;
  }

  async reset(sessionId: string, key: string): Promise<void> {
    this.validate(sessionId);
    const events = await this.readEvents(sessionId);
    const remaining = events.filter((e) => e.key !== key);
    remaining.push({ sessionId, key, count: 0, timestamp: new Date().toISOString() });
    await mkdir(this.dir, { recursive: true });
    const target = this.filepath(sessionId);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, remaining.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    await rename(tmp, target);
  }

  async list(sessionId: string): Promise<RetryStateEntry[]> {
    this.validate(sessionId);
    const events = await this.readEvents(sessionId);
    const map = new Map<string, number>();
    for (const e of events) {
      if (e.count === 0) map.delete(e.key);
      else map.set(e.key, e.count);
    }
    return [...map.entries()].map(([key, count]) => ({ key, count }));
  }
}
