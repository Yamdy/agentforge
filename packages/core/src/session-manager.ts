import type { SessionStorage, SessionRecord, SessionManager, PipelineContext, SessionEvent } from '@agentforge/sdk';
import type { EventBus } from './event-bus.js';

export class SessionManagerImpl implements SessionManager {
  constructor(
    private storage: SessionStorage,
    private bus: EventBus,
  ) {}

  async start(input: string, options?: { parentSessionId?: string }): Promise<SessionRecord> {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    const record: SessionRecord = {
      sessionId,
      parentSessionId: options?.parentSessionId,
      createdAt: now,
      updatedAt: now,
      status: 'active',
    };

    await this.storage.updateMeta(sessionId, record);

    this.bus.emit('agent:start', { sessionId, input });

    return record;
  }

  async restore(sessionId: string): Promise<PipelineContext> {
    const events: SessionEvent[] = [];
    for await (const event of this.storage.read(sessionId)) {
      events.push(event);
    }

    if (events.length === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Replay events to reconstruct context
    let input = '';
    let lastStep = 0;
    const messageHistory: Array<Record<string, unknown>> = [];

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      if (event.type === 'agent:start' && payload.input) {
        input = payload.input as string;
      }

      if (event.type === 'iteration.end') {
        lastStep = (payload.step as number) + 1;
        if (payload.response) {
          messageHistory.push({ step: payload.step, response: payload.response });
        }
      }
    }

    return {
      request: { input, sessionId },
      iteration: { step: lastStep },
      pipeline: {},
      session: { messageHistory },
      config: {},
    };
  }

  async suspend(sessionId: string, reason: string): Promise<void> {
    // Emit through EventBus so SessionPersistence handles seq + write
    this.bus.emit('session:suspended', { sessionId, reason });

    await this.storage.updateMeta(sessionId, { status: 'suspended' });
  }

  async resume(sessionId: string, input?: string): Promise<string> {
    // Mark original session as completed
    await this.storage.updateMeta(sessionId, { status: 'completed' });

    // Start a new continuation session linked to the original
    const child = await this.start(input ?? '', { parentSessionId: sessionId });
    return child.sessionId;
  }

  async list(filter?: { parentSessionId?: string }): Promise<SessionRecord[]> {
    return this.storage.list(filter);
  }
}
