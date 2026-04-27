import { DefaultHITLController, generateSessionId } from '@primo512109/agentforge';
import type { AgentEvent, L1AgentConfig } from '@primo512109/agentforge';
import type { ChatMessage, Session } from './types.js';

/**
 * In-memory session store for managing chat sessions.
 *
 * Single-thread safety: Map operations are atomic in the Node.js event loop.
 * If Worker Threads or multi-process architecture is introduced, proper locking
 * must be added.
 */
export class InMemorySessionStore {
  private sessions = new Map<string, Session>();

  create(agentConfigId: string, configOverrides?: Partial<L1AgentConfig>): Session {
    const id = generateSessionId('sess');
    const now = new Date().toISOString();
    const session: Session = {
      id,
      agentConfigId,
      ...(configOverrides ? { configOverrides } : {}),
      messages: [],
      events: [],
      hitlController: new DefaultHITLController(),
      activeRun: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id);
    if (session?.activeRun) {
      session.activeRun.abort();
    }
    return this.sessions.delete(id);
  }

  addMessage(id: string, message: ChatMessage): void {
    const session = this.sessions.get(id);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date().toISOString();
    }
  }

  addEvent(id: string, event: AgentEvent): void {
    const session = this.sessions.get(id);
    if (session) {
      session.events.push(event);
      session.updatedAt = new Date().toISOString();
    }
  }

  clear(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.messages = [];
      session.events = [];
      session.updatedAt = new Date().toISOString();
    }
  }
}