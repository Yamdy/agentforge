import { Effect } from "effect";
import {
  Session,
  SessionManager,
  CreateSessionOptions,
  SessionError,
  Message,
} from "./types";
import { Log } from "./log";

const logger = Log.create({ service: "session-manager" });

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
      logger.info("会话创建成功", { sessionId: id, initialMessagesCount: session.messages.length });
      return session;
    });
  }

  get(id: string): Effect.Effect<Session | undefined, never> {
    return Effect.sync(() => {
      const session = this.sessions.get(id);
      logger.debug("查询会话", { sessionId: id, exists: !!session });
      return session;
    });
  }

  addMessage(sessionId: string, message: Message): Effect.Effect<Session, SessionError> {
    return Effect.sync(() => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        logger.error("会话不存在", { sessionId });
        throw new SessionError(`Session not found: ${sessionId}`);
      }
      const updatedSession: Session = {
        ...session,
        messages: [...session.messages, message],
      };
      this.sessions.set(sessionId, updatedSession);
      logger.info("添加消息到会话", { sessionId, role: message.role, contentLength: message.content?.length || 0 });
      return updatedSession;
    });
  }
}
