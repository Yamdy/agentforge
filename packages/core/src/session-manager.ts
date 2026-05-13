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

    let input = '';
    let lastStep = 0;
    const messageHistory: Array<Record<string, unknown>> = [];
    let agentConfig: Record<string, unknown> = {};
    let promptFragments: string[] = [];
    let toolDeclarations: Array<{ name: string; description: string }> = [];
    let totalTokenUsage: { input: number; output: number } | undefined;
    let lastResponse: string | undefined;
    const custom: Record<string, unknown> = {};

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | undefined;
      if (!payload) continue;

      switch (event.type) {
        case 'agent:start': {
          if (payload.input) input = payload.input as string;
          if (payload.agentConfig) agentConfig = payload.agentConfig as Record<string, unknown>;
          if (payload.promptFragments) promptFragments = payload.promptFragments as string[];
          if (payload.toolDeclarations) toolDeclarations = payload.toolDeclarations as Array<{ name: string; description: string }>;
          break;
        }
        case 'iteration:end':
        case 'iteration.end': {
          lastStep = (payload.step as number) + 1;
          if (payload.response) {
            lastResponse = payload.response as string;
            messageHistory.push({ step: payload.step, response: payload.response });
          }
          if (payload.tokenUsage) {
            totalTokenUsage = payload.tokenUsage as { input: number; output: number };
          }
          break;
        }
        case 'tool:before':
        case 'tool.before': {
          messageHistory.push({ type: 'tool_call', name: payload.toolName, args: payload.args });
          break;
        }
        case 'tool:after':
        case 'tool.after': {
          messageHistory.push({ type: 'tool_result', name: payload.toolName, result: payload.result, error: payload.error });
          break;
        }
        case 'llm:after':
        case 'llm.after': {
          if (payload.tokenUsage) {
            const usage = payload.tokenUsage as { input: number; output: number };
            totalTokenUsage = totalTokenUsage
              ? { input: totalTokenUsage.input + usage.input, output: totalTokenUsage.output + usage.output }
              : usage;
          }
          break;
        }
        case 'error': {
          messageHistory.push({ type: 'error', error: String(payload.error) });
          break;
        }
        case 'session:suspended': {
          custom.suspendReason = payload.reason;
          break;
        }
        case 'stage:before':
        case 'stage:after':
        case 'llm:before':
        case 'agent:end':
          break;
      }
    }

    return {
      request: { input, sessionId },
      agent: { config: agentConfig as unknown as PipelineContext['agent']['config'], promptFragments, toolDeclarations },
      iteration: { step: lastStep, response: lastResponse },
      session: { messageHistory: messageHistory as PipelineContext['session']['messageHistory'], totalTokenUsage, custom },
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
