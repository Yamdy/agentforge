import { Storage, NotFoundError } from '../storage/index.js';
import type { Checkpoint, SessionMessage, PendingToolCall } from './types.js';
import type { TaskState } from '../types.js';

interface CreateCheckpointOptions {
  messages: SessionMessage[];
  toolCalls: PendingToolCall[];
  state: TaskState;
  metadata?: Record<string, unknown>;
}

/**
 * 检查点管理器
 */
export class CheckpointManager {
  /**
   * 初始化存储
   */
  async init(): Promise<void> {
    // Storage 模块自动初始化
  }

  /**
   * 创建检查点
   * @param sessionId 会话 ID
   * @param stepIndex 步骤索引
   * @param options 检查点选项
   * @returns 创建的检查点
   */
  async create(
    sessionId: string,
    stepIndex: number,
    options: CreateCheckpointOptions
  ): Promise<Checkpoint> {
    const id = `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const checkpoint: Checkpoint = {
      id,
      sessionId,
      stepIndex,
      messages: [...options.messages],
      toolCalls: [...options.toolCalls],
      state: { ...options.state },
      createdAt: Date.now(),
      metadata: options.metadata,
    };

    await Storage.write(['checkpoint', id], checkpoint);
    return checkpoint;
  }

  /**
   * 恢复检查点
   * @param checkpointId 检查点 ID
   * @returns 检查点数据，如果不存在则返回 null
   */
  async restore(checkpointId: string): Promise<Checkpoint | null> {
    try {
      return await Storage.read<Checkpoint>(['checkpoint', checkpointId]);
    } catch (e) {
      if (e instanceof NotFoundError) {
        return null;
      }
      throw e;
    }
  }

  /**
   * 列出会话的所有检查点
   * @param sessionId 会话 ID
   * @returns 检查点列表（按步骤索引降序排序）
   */
  async list(sessionId: string): Promise<Checkpoint[]> {
    const allKeys = await Storage.list(['checkpoint']);
    const checkpoints: Checkpoint[] = [];

    for (const key of allKeys) {
      try {
        const checkpoint = await Storage.read<Checkpoint>(['checkpoint', key[key.length - 1]]);
        if (checkpoint.sessionId === sessionId) {
          checkpoints.push(checkpoint);
        }
      } catch {
        // 跳过无效条目
      }
    }

    // 按步骤索引降序排序（最新的在前）
    return checkpoints.sort((a, b) => b.stepIndex - a.stepIndex);
  }

  /**
   * 删除检查点
   * @param checkpointId 检查点 ID
   * @returns 是否删除成功
   */
  async delete(checkpointId: string): Promise<boolean> {
    try {
      await Storage.remove(['checkpoint', checkpointId]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清理会话的所有检查点
   * @param sessionId 会话 ID
   */
  async clear(sessionId: string): Promise<void> {
    const checkpoints = await this.list(sessionId);
    for (const cp of checkpoints) {
      await this.delete(cp.id);
    }
  }
}
