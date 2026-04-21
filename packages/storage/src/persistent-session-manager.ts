import { Effect } from "effect";
import type { Session, Message } from "@agentforge/core";
import { SessionError } from "@agentforge/core";
import type { Memory, CompressionConfig } from "@agentforge/memory";
import { randomUUID } from "node:crypto";
import type { PersistentSessionManagerConfig, Storage } from "./types";

/**
 * 持久化会话元数据结构
 */
interface SessionMeta {
  id: string;
  systemPrompt?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 持久化会话管理器，完全实现Memory接口，可无缝替换InMemorySessionManager
 */
export class PersistentSessionManager implements Memory<Session> {
  private storage: Storage;
  private maxMessagesPerSession: number;
  private autoTrim: boolean;
  private trimKeepCount: number;

  constructor(config: PersistentSessionManagerConfig) {
    this.storage = config.storage;
    this.maxMessagesPerSession = config.maxMessagesPerSession ?? 200;
    this.autoTrim = config.autoTrim ?? true;
    this.trimKeepCount = config.trimKeepCount ?? 100;
  }

  /**
   * 创建新会话
   */
  create(options?: {
    systemPrompt?: string;
    initialMessages?: Message[];
    metadata?: Record<string, unknown>;
  }): Effect.Effect<Session, never> {
    return Effect.tryPromise(async () => {
      const id = randomUUID();
      const now = Date.now();

      // 会话元数据
      const meta: SessionMeta = {
        id,
        systemPrompt: options?.systemPrompt,
        metadata: options?.metadata ?? {},
        createdAt: now,
        updatedAt: now
      };

      // 初始消息
      const messages: Message[] = options?.initialMessages ?? [];

      // 持久化
      await Effect.runPromise(this.storage.write(["session", id], meta));
      await Effect.runPromise(this.storage.write(["message", id], messages));

      return {
        id,
        systemPrompt: meta.systemPrompt,
        messages,
        metadata: meta.metadata,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt)
      };
    });
  }

  /**
   * 根据ID获取会话
   */
  get(id: string): Effect.Effect<Session | undefined, never> {
    return Effect.tryPromise(async () => {
      try {
        // 读取元数据和消息
        const meta = await Effect.runPromise(this.storage.read<SessionMeta>(["session", id]));
        const messages = await Effect.runPromise(this.storage.read<Message[]>(["message", id]));

        return {
          id: meta.id,
          systemPrompt: meta.systemPrompt,
          messages,
          metadata: meta.metadata,
          createdAt: new Date(meta.createdAt),
          updatedAt: new Date(meta.updatedAt)
        };
      } catch (err) {
        // 会话不存在返回undefined
        console.error("Failed to get session", err);
        return undefined;
      }
    });
  }

  /**
   * 给会话添加消息
   */
  addMessage(sessionId: string, message: Message): Effect.Effect<Session, SessionError> {
    return Effect.tryPromise(async () => {
      // 更新消息
      const messages = await Effect.runPromise(this.storage.update<Message[]>(["message", sessionId], (draft: any) => {
        // 添加时间戳
        const msgWithTime = { ...message, createdAt: Date.now() };
        draft.push(msgWithTime);
      }));

      // 自动裁剪
      let trimmedMessages = messages;
      if (this.autoTrim && messages.length > this.maxMessagesPerSession) {
        trimmedMessages = messages.slice(-this.trimKeepCount);
        await Effect.runPromise(this.storage.write(["message", sessionId], trimmedMessages));
      }

      // 更新会话元数据的更新时间
      const meta = await Effect.runPromise(this.storage.update<SessionMeta>(["session", sessionId], (draft: any) => {
        draft.updatedAt = Date.now();
      }));

      return {
        id: sessionId,
        systemPrompt: meta.systemPrompt,
        messages: trimmedMessages,
        metadata: meta.metadata,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt)
      };
    });
  }

  /**
   * 删除会话
   */
  delete(id: string): Effect.Effect<void, SessionError> {
    return Effect.tryPromise(async () => {
      await Effect.runPromise(this.storage.remove(["session", id]));
      await Effect.runPromise(this.storage.remove(["message", id]));
      // 删除相关的检查点和摘要
      await Effect.runPromise(this.storage.remove(["checkpoint", id]));
      await Effect.runPromise(this.storage.remove(["summary", id]));
    });
  }

  /**
   * 列出所有会话
   */
  list(): Effect.Effect<Session[], never> {
    return Effect.tryPromise(async () => {
      try {
        // 获取所有会话ID
        const keys = await Effect.runPromise(this.storage.list(["session"]));
        const sessionIds = keys.map(key => key[0]).filter(Boolean);

        // 批量读取会话
        const sessions: Session[] = [];
        for (const id of sessionIds) {
          try {
            const session = await Effect.runPromise(this.get(id));
            if (session) {
              sessions.push(session);
            }
          } catch (err) {
            // 忽略损坏的会话
            console.warn(`Ignoring corrupted session ${id}`, err);
          }
        }

        // 按更新时间倒序排列
        return sessions.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
      } catch (err) {
        console.error("Failed to list sessions", err);
        return [];
      }
    });
  }

  /**
   * 裁剪会话消息
   */
  trim(sessionId: string, options?: {
    maxMessages?: number;
    maxTokens?: number;
    tokenizer?: (text: string) => number;
    compression?: CompressionConfig;
  }): Effect.Effect<Session, SessionError> {
    return Effect.tryPromise(async () => {
      const maxMessages = options?.maxMessages ?? this.trimKeepCount;
      const messages = await Effect.runPromise(this.storage.update<Message[]>(["message", sessionId], (draft: any) => {
        // 保留最新的maxMessages条
        draft.splice(0, draft.length - maxMessages);
      }));

      // 更新会话更新时间
      const meta = await Effect.runPromise(this.storage.update<SessionMeta>(["session", sessionId], (draft: any) => {
        draft.updatedAt = Date.now();
      }));

      return {
        id: sessionId,
        systemPrompt: meta.systemPrompt,
        messages,
        metadata: meta.metadata,
        createdAt: new Date(meta.createdAt),
        updatedAt: new Date(meta.updatedAt)
      };
    });
  }
}
