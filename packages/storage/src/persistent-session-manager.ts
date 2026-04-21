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
  messageCount?: number;  // 缓存消息数量，避免每次读取所有消息
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

      // 持久化会话元数据
      meta.messageCount = messages.length;
      await Effect.runPromise(this.storage.write(["session", id], meta));
      
      // 持久化消息（每个消息单独文件）
      for (let i = 0; i < messages.length; i++) {
        const msgId = `msg_${i}_${Date.now()}`;
        await Effect.runPromise(this.storage.write(["message", id, msgId], messages[i]));
      }

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
        const messages = await Effect.runPromise(this._loadMessages(id));

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
      // 生成消息ID
      const msgId = `msg_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const msgWithTime = { ...message, id: msgId, createdAt: Date.now() };
      
      // 写入单个消息文件
      await Effect.runPromise(this.storage.write(["message", sessionId, msgId], msgWithTime));
      
      // 更新会话元数据
      const meta = await Effect.runPromise(this.storage.update<SessionMeta>(["session", sessionId], (draft: any) => {
        draft.updatedAt = Date.now();
        draft.messageCount = (draft.messageCount || 0) + 1;
      }));
      
      // 自动裁剪
      if (this.autoTrim && meta.messageCount! > this.maxMessagesPerSession) {
        // 获取所有消息ID（按时间排序）
        const msgKeys = await Effect.runPromise(this.storage.list(["message", sessionId]));
        // 删除旧消息（保留最新的 trimKeepCount 条）
        const toDelete = msgKeys.slice(0, msgKeys.length - this.trimKeepCount);
        for (const key of toDelete) {
          await Effect.runPromise(this.storage.remove(["message", sessionId, key[0]])).catch(() => {});
        }
        meta.messageCount = msgKeys.length - toDelete.length;
        
        // 重新写入更新后的元数据
        await Effect.runPromise(this.storage.write(["session", sessionId], meta));
      }
      
      // 读取所有消息
      const messages = await Effect.runPromise(this._loadMessages(sessionId));
      
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
  
  /**
   * 内部方法：加载会话的所有消息
   */
  private _loadMessages(sessionId: string): Effect.Effect<Message[], never> {
    return Effect.tryPromise(async () => {
      try {
        const msgKeys = await Effect.runPromise(this.storage.list(["message", sessionId]));
        const messages: Message[] = [];
        for (const key of msgKeys) {
          try {
            const msg = await Effect.runPromise(this.storage.read<Message>(["message", sessionId, key[0]]));
            messages.push(msg);
          } catch {
            // 忽略损坏的消息文件
          }
        }
        // 按创建时间排序
        return messages.sort((a, b) => 
          ((a as any).createdAt || 0) - ((b as any).createdAt || 0)
        );
      } catch {
        return [];
      }
    });
  }

  /**
   * 删除会话
   */
  delete(id: string): Effect.Effect<void, SessionError> {
    return Effect.tryPromise(async () => {
      // 删除会话元数据
      await Effect.runPromise(this.storage.remove(["session", id]));
      
      // 删除所有消息文件
      const msgKeys = await Effect.runPromise(this.storage.list(["message", id]));
      for (const key of msgKeys) {
        await Effect.runPromise(this.storage.remove(["message", id, key[0]])).catch(() => {});
      }
      
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
      
      // 获取所有消息ID
      const msgKeys = await Effect.runPromise(this.storage.list(["message", sessionId]));
      
      // 删除旧消息（保留最新的 maxMessages 条）
      const toDelete = msgKeys.slice(0, msgKeys.length - maxMessages);
      for (const key of toDelete) {
        await Effect.runPromise(this.storage.remove(["message", sessionId, key[0]])).catch(() => {});
      }
      
      // 读取剩余消息
      const messages = await Effect.runPromise(this._loadMessages(sessionId));

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
