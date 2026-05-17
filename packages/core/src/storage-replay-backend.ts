import type { ReplayBackend, SessionStorage, SessionEvent } from '@primo-ai/sdk';

export class StorageReplayBackend implements ReplayBackend {
  constructor(private storage: SessionStorage) {}

  async query(sessionId: string): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    for await (const event of this.storage.read(sessionId)) {
      events.push(event);
    }
    return events;
  }
}
