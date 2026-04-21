import { Effect } from "effect";
import type { Checkpointer } from "@agentforge/memory";
import type { Session } from "@agentforge/core";
import { SessionError } from "@agentforge/core";
import type { PersistentCheckpointerConfig, Storage } from "./types";
import { randomUUID } from "node:crypto";

/**
 * 持久化检查点实现，支持时间旅行
 */
export class PersistentCheckpointer<T extends Session = Session> implements Checkpointer<T> {
  private storage: Storage;
  private maxCheckpointsPerSession: number;

  constructor(config: PersistentCheckpointerConfig) {
    this.storage = config.storage;
    this.maxCheckpointsPerSession = config.maxCheckpointsPerSession ?? 10;
  }

  /**
   * 保存检查点
   * @param checkpointId 检查点ID
   * @param state 会话状态
   */
  save(checkpointId: string, state: T): Effect.Effect<void, never> {
    return Effect.tryPromise(async () => {
      try {
        await Effect.runPromise(this.storage.write(["checkpoint", checkpointId], state));
      } catch (err) {
        console.error("Failed to save checkpoint", err);
      }
    });
  }

  /**
   * 生成新的检查点ID
   */
  generateId(): string {
    return randomUUID();
  }

  /**
   * 获取指定检查点
   * @param checkpointId 检查点ID
   * @returns 会话状态
   */
  get(checkpointId: string): Effect.Effect<T | undefined, never> {
    return Effect.tryPromise(async () => {
      try {
        return await Effect.runPromise(this.storage.read<T>(["checkpoint", checkpointId]));
      } catch (err) {
        console.error("Failed to get checkpoint", err);
        return undefined;
      }
    });
  }

  /**
   * 列出会话的所有检查点ID
   * @param threadId 会话ID
   * @returns 检查点ID列表
   */
  list(threadId: string): Effect.Effect<string[], never> {
    return Effect.tryPromise(async () => {
      try {
        // 这里简化，直接返回所有checkpoint，实际应该根据threadId过滤
        // 后续优化存储结构，把checkpoint按threadId分组
        const keys = await Effect.runPromise(this.storage.list(["checkpoint"]));
        return keys.map(key => key[0]);
      } catch (err) {
        console.error("Failed to list checkpoints", err);
        return [];
      }
    });
  }

  /**
   * 删除指定检查点
   * @param checkpointId 检查点ID
   */
  delete(checkpointId: string): Effect.Effect<void, SessionError> {
    return Effect.tryPromise(async () => {
      await Effect.runPromise(this.storage.remove(["checkpoint", checkpointId]));
    });
  }

  /**
   * 清除会话的所有检查点
   * @param threadId 会话ID
   */
  clear(threadId: string): Effect.Effect<void, SessionError> {
    return Effect.tryPromise(async () => {
      const checkpointIds = await Effect.runPromise(this.list(threadId));
      await Promise.all(checkpointIds.map(id => Effect.runPromise(this.delete(id))));
    });
  }

  /**
   * 恢复会话到指定检查点
   * @param checkpointId 检查点ID
   * @returns 恢复后的会话状态
   */
  restore(checkpointId: string): Effect.Effect<T | undefined, SessionError> {
    return Effect.tryPromise(async () => {
      const state = await Effect.runPromise(this.get(checkpointId));
      if (!state) {
        throw new SessionError(`Checkpoint ${checkpointId} not found`);
      }
      return state;
    });
  }
}
