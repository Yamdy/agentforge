import type { SessionStorage, SessionEvent } from '@primo-ai/sdk';
import type { EventBus } from './event-bus.js';
import { REPLAY_SENTINEL } from './event-system.js';

const SUBSCRIBED_EVENTS = [
  'agent:start',
  'stage:before',
  'stage:after',
  'agent:end',
  'tool:before',
  'tool:after',
  'llm:before',
  'llm:after',
  'iteration:end',
  'error',
  'session:suspended',
  'session:resumed',
  'permission:requested',
  'permission:decided',
];

export class SessionPersistence {
  private unsubs: Array<() => void> = [];
  private seqCounters = new Map<string, number>();
  private writeQueues = new Map<string, Promise<void>>();
  private bus: EventBus;

  constructor(bus: EventBus, private storage: SessionStorage) {
    this.bus = bus;
    for (const eventType of SUBSCRIBED_EVENTS) {
      const unsub = bus.subscribe(eventType, (data) => {
        this.onEvent(eventType, data);
      });
      this.unsubs.push(unsub);
    }
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    await Promise.all([...this.writeQueues.values()].map(p => p.catch(() => {})));
  }

  private onEvent(eventType: string, data: unknown): void {
    // Skip replayed events to avoid duplicate writes
    if (typeof data === 'object' && data !== null && REPLAY_SENTINEL in (data as Record<string, unknown>)) {
      return;
    }
    const payload = data as Record<string, unknown> | undefined;
    const sessionId = payload?.sessionId as string | undefined;
    if (!sessionId) return;

    const seq = (this.seqCounters.get(sessionId) ?? 0) + 1;
    this.seqCounters.set(sessionId, seq);

    const event: SessionEvent = {
      seq,
      timestamp: new Date().toISOString(),
      type: eventType,
      payload: data,
    };

    const prev = this.writeQueues.get(sessionId) ?? Promise.resolve();
    const write = prev
      .then(() => this.storage.append(sessionId, event))
      .catch((err) => {
        this.bus.emit('session:write_failed', { sessionId, error: err instanceof Error ? err.message : String(err) });
      });
    this.writeQueues.set(sessionId, write);
  }
}
