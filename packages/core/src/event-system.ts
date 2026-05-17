import type { ReplayBackend, ReplayOptions, SessionEvent } from '@primo-ai/sdk';
import { EventBus } from './event-bus.js';

/** Sentinel key added to replayed event payloads. Reserved namespace: plugins MUST NOT use this key in event payloads. */
export const REPLAY_SENTINEL = '__agentforge_replay';

export class EventSystem {
  private _bus: EventBus;
  private backend?: ReplayBackend;

  constructor(onError?: (error: unknown, eventType: string) => void) {
    this._bus = new EventBus(onError);
  }

  /** Attach a ReplayBackend (typically wraps SessionStorage). */
  setReplayBackend(backend: ReplayBackend): void {
    this.backend = backend;
  }

  /** The underlying EventBus — used for wiring to HookManager, ToolRegistry, etc. */
  get bus(): EventBus {
    return this._bus;
  }

  emit(eventType: string, data?: unknown): void {
    this._bus.emit(eventType, data);
  }

  subscribe(eventType: string, handler: (data?: unknown) => void): () => void {
    return this._bus.subscribe(eventType, handler);
  }

  async query(sessionId: string): Promise<SessionEvent[]> {
    if (!this.backend) return [];
    return this.backend.query(sessionId);
  }

  async replay(sessionId: string, options?: ReplayOptions): Promise<void> {
    const events = await this.query(sessionId);
    if (events.length === 0) return;

    const filtered = this.filterEvents(events, options);
    for (const event of filtered) {
      const payload = typeof event.payload === 'object' && event.payload !== null && !Array.isArray(event.payload)
        ? { ...event.payload, [REPLAY_SENTINEL]: true }
        : event.payload;
      this._bus.emit(event.type, payload);
    }
  }

  private filterEvents(events: SessionEvent[], options?: ReplayOptions): SessionEvent[] {
    if (!options) return events;
    let result = events;
    if (options.fromSeq !== undefined) {
      result = result.filter(e => e.seq >= options.fromSeq!);
    }
    if (options.toSeq !== undefined) {
      result = result.filter(e => e.seq <= options.toSeq!);
    }
    if (options.eventTypes && options.eventTypes.length > 0) {
      const typeSet = new Set(options.eventTypes);
      result = result.filter(e => typeSet.has(e.type));
    }
    return result;
  }
}
