import type { MemoryStorage, MemoryEvent, EventQuery } from './types.js';

let seqCounter = 0;
function nextEventId(): string {
  seqCounter++;
  return `evt-${Date.now()}-${seqCounter}`;
}

function extractSeq(id: string): number {
  const parts = id.split('-');
  return parseInt(parts[parts.length - 1], 10) || 0;
}

function sortChronological(events: MemoryEvent[]): MemoryEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp < b.timestamp) return -1;
    if (a.timestamp > b.timestamp) return 1;
    return extractSeq(a.id) - extractSeq(b.id);
  });
}

function sortReverseChronological(events: MemoryEvent[]): MemoryEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp > b.timestamp) return -1;
    if (a.timestamp < b.timestamp) return 1;
    return extractSeq(b.id) - extractSeq(a.id);
  });
}

export interface EventSummary {
  total: number;
  byType: Record<string, number>;
  oldest?: string;
  newest?: string;
}

export class EpisodicMemory {
  private storage: MemoryStorage;

  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  async addEvent(
    scope: string,
    content: string,
    options?: {
      type?: MemoryEvent['type'];
      importance?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<string> {
    const id = nextEventId();
    const now = new Date().toISOString();
    const event: MemoryEvent = {
      id,
      timestamp: now,
      type: options?.type ?? 'user_input',
      content,
      importance: options?.importance ?? 0.5,
      metadata: options?.metadata,
    };
    await this.storage.appendEvent(scope, event);
    return id;
  }

  async query(scope: string, query?: EventQuery): Promise<MemoryEvent[]> {
    return this.storage.getEvents(scope, query);
  }

  async getTimeline(
    scope: string,
    options?: { start?: string; end?: string; limit?: number },
  ): Promise<MemoryEvent[]> {
    const timeRange =
      options?.start || options?.end
        ? { start: options?.start ?? '1970-01-01T00:00:00Z', end: options?.end ?? '9999-12-31T23:59:59Z' }
        : undefined;
    let events = await this.storage.getEvents(scope, { timeRange, limit: options?.limit });
    events = sortChronological(events);
    if (options?.limit !== undefined) {
      events = events.slice(0, options.limit);
    }
    return events;
  }

  async getRecent(scope: string, limit = 10): Promise<MemoryEvent[]> {
    let events = await this.storage.getEvents(scope);
    events = sortReverseChronological(events);
    return events.slice(0, limit);
  }

  async count(scope: string, query?: EventQuery): Promise<number> {
    const events = await this.storage.getEvents(scope, query);
    return events.length;
  }

  async summarize(
    scope: string,
    timeRange?: { start: string; end: string },
  ): Promise<EventSummary> {
    const events = await this.storage.getEvents(scope, { timeRange });
    const byType: Record<string, number> = {};
    let oldest: string | undefined;
    let newest: string | undefined;

    for (const e of events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (!oldest || e.timestamp < oldest) oldest = e.timestamp;
      if (!newest || e.timestamp > newest) newest = e.timestamp;
    }

    return { total: events.length, byType, oldest, newest };
  }
}
