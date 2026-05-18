import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// SyncEvent type — versioned, sequenced event for event sourcing
// ---------------------------------------------------------------------------
export interface SyncEvent<T = unknown> {
  /** Event schema version. Starts at 1, incremented on breaking changes. */
  readonly version: number;
  /** Logical aggregate identifier. */
  readonly aggregateId: string;
  /** Monotonic, gap-free sequence number scoped to the aggregate. */
  readonly seq: number;
  /** Unix-epoch millisecond timestamp of when the event was created. */
  readonly timestamp: number;
  /** Event type discriminator. */
  readonly type: string;
  /** Event payload. */
  readonly payload: T;
}

// ---------------------------------------------------------------------------
// SyncEventStore interface
// ---------------------------------------------------------------------------
export interface SyncEventStore<T = unknown> {
  /**
   * Append a new event. Atomically allocates the next sequence number.
   *
   * @param aggregateId  Logical aggregate identifier.
   * @param type         Event type discriminator.
   * @param payload      Event payload.
   * @param version      Schema version (defaults to 1).
   */
  append(
    aggregateId: string,
    type: string,
    payload: T,
    version?: number,
  ): Promise<SyncEvent<T>>;

  /**
   * Replay events for an aggregate, optionally from a specific sequence
   * number and optionally validating the schema version.
   *
   * @param aggregateId  Logical aggregate identifier.
   * @param fromSeq      Optional starting sequence number (inclusive, 1-based).
   * @param expectedVersion  Optional expected schema version — throws
   *                         `VersionMismatchError` if any event has a
   *                         different version.
   */
  replay(
    aggregateId: string,
    fromSeq?: number,
    expectedVersion?: number,
  ): AsyncGenerator<SyncEvent<T>>;

  /**
   * Return the highest sequence number stored for the given aggregate.
   * Returns 0 if no events exist.
   */
  getLastSeq(aggregateId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// VersionMismatchError
// ---------------------------------------------------------------------------
export class VersionMismatchError extends Error {
  override readonly name = 'VersionMismatchError';

  constructor(
    public readonly aggregateId: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `Version mismatch for aggregate "${aggregateId}": expected ${expected}, got ${actual}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hasCode(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

function validateAggregateId(aggregateId: string): void {
  if (
    aggregateId.includes('/') ||
    aggregateId.includes('\\') ||
    aggregateId.includes('..')
  ) {
    throw new Error(`Invalid aggregateId: ${aggregateId}`);
  }
}

// ---------------------------------------------------------------------------
// InMemorySyncEventStore
// ---------------------------------------------------------------------------
export class InMemorySyncEventStore<T = unknown>
  implements SyncEventStore<T>
{
  /** Per-aggregate event arrays. */
  private events = new Map<string, Array<SyncEvent<T>>>();
  /** Per-aggregate sequence counters. */
  private counters = new Map<string, number>();

  async append(
    aggregateId: string,
    type: string,
    payload: T,
    version = 1,
  ): Promise<SyncEvent<T>> {
    const seq = (this.counters.get(aggregateId) ?? 0) + 1;
    this.counters.set(aggregateId, seq);

    const event: SyncEvent<T> = {
      version,
      aggregateId,
      seq,
      timestamp: Date.now(),
      type,
      payload,
    };

    const list = this.events.get(aggregateId) ?? [];
    list.push(event);
    this.events.set(aggregateId, list);

    return event;
  }

  async *replay(
    aggregateId: string,
    fromSeq?: number,
    expectedVersion?: number,
  ): AsyncGenerator<SyncEvent<T>> {
    const list = this.events.get(aggregateId) ?? [];
    const start = fromSeq ?? 1;

    for (const event of list) {
      if (event.seq < start) continue;

      if (expectedVersion !== undefined && event.version !== expectedVersion) {
        throw new VersionMismatchError(
          aggregateId,
          expectedVersion,
          event.version,
        );
      }

      yield event;
    }
  }

  async getLastSeq(aggregateId: string): Promise<number> {
    return this.counters.get(aggregateId) ?? 0;
  }
}

// ---------------------------------------------------------------------------
// JsonlSyncEventStore
// ---------------------------------------------------------------------------
export class JsonlSyncEventStore<T = unknown> implements SyncEventStore<T> {
  constructor(private dir: string) {}

  private path(aggregateId: string): string {
    return join(this.dir, `${aggregateId}.jsonl`);
  }

  async append(
    aggregateId: string,
    type: string,
    payload: T,
    version = 1,
  ): Promise<SyncEvent<T>> {
    validateAggregateId(aggregateId);

    await mkdir(this.dir, { recursive: true });

    const target = this.path(aggregateId);

    // Read existing events to determine next seq number
    let seq = 0;
    try {
      const content = await readFile(target, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]) as SyncEvent<T>;
        seq = last.seq;
      }
    } catch (err: unknown) {
      if (!hasCode(err) || err.code !== 'ENOENT') throw err;
      // File doesn't exist yet — seq stays 0
    }

    seq += 1;

    const event: SyncEvent<T> = {
      version,
      aggregateId,
      seq,
      timestamp: Date.now(),
      type,
      payload,
    };

    // Atomic append: write to tmp, then rename
    const tmp = `${target}.tmp`;
    // Read existing content or start fresh
    let existing = '';
    try {
      existing = await readFile(target, 'utf-8');
    } catch (err: unknown) {
      if (!hasCode(err) || err.code !== 'ENOENT') throw err;
    }
    await writeFile(tmp, existing + JSON.stringify(event) + '\n', 'utf-8');
    await rename(tmp, target);

    return event;
  }

  async *replay(
    aggregateId: string,
    fromSeq?: number,
    expectedVersion?: number,
  ): AsyncGenerator<SyncEvent<T>> {
    validateAggregateId(aggregateId);

    const start = fromSeq ?? 1;

    try {
      const content = await readFile(this.path(aggregateId), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const event = JSON.parse(line) as SyncEvent<T>;

        if (event.seq < start) continue;

        if (
          expectedVersion !== undefined &&
          event.version !== expectedVersion
        ) {
          throw new VersionMismatchError(
            aggregateId,
            expectedVersion,
            event.version,
          );
        }

        yield event;
      }
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return;
      throw err;
    }
  }

  async getLastSeq(aggregateId: string): Promise<number> {
    validateAggregateId(aggregateId);

    try {
      const content = await readFile(this.path(aggregateId), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return 0;

      const last = JSON.parse(lines[lines.length - 1]) as SyncEvent<T>;
      return last.seq;
    } catch (err: unknown) {
      if (hasCode(err) && err.code === 'ENOENT') return 0;
      throw err;
    }
  }
}
