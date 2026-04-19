import { Effect } from "effect";
import {
  Session,
  SessionManager,
  CreateSessionOptions,
  SessionError,
  Message,
} from "./types";

export class InMemorySessionManager implements SessionManager {
  private sessions = new Map<string, Session>();
  private nextId = 1;

  create(options?: CreateSessionOptions): Effect.Effect<Session, never> {
    return Effect.sync(() => {
      const id = `session-${this.nextId++}`;
      const session: Session = {
        id,
        messages: options?.initialMessages || [],
        systemPrompt: options?.systemPrompt,
      };
      this.sessions.set(id, session);
      return session;
    });
  }

  get(id: string): Effect.Effect<Session | undefined, never> {
    return Effect.sync(() => this.sessions.get(id));
  }

  addMessage(sessionId: string, message: Message): Effect.Effect<Session, SessionError> {
    return Effect.sync(() => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new SessionError(`Session not found: ${sessionId}`);
      }
      const updatedSession: Session = {
        ...session,
        messages: [...session.messages, message],
      };
      this.sessions.set(sessionId, updatedSession);
      return updatedSession;
    });
  }
}
