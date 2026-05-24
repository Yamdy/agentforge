/**
 * 存储层错误类型
 *
 * 为存储操作提供结构化的错误信息，包含操作名、表名等上下文，
 * 便于调试和错误恢复。
 */

import { AppError, type AppErrorOptions } from './types.js';

/**
 * 存储操作名称
 */
export type StorageOperation =
  | 'initialize'
  | 'close'
  | 'getThread'
  | 'saveThread'
  | 'deleteThread'
  | 'listThreads'
  | 'getMessages'
  | 'addMessage'
  | 'getWorkingMemory'
  | 'saveWorkingMemory'
  | 'getObservationalMemory'
  | 'saveObservationalMemory'
  | 'getAgentState'
  | 'saveAgentState'
  | 'deleteAgentState'
  | 'listAgentStates'
  | 'getCheckpoint'
  | 'saveCheckpoint'
  | 'listCheckpoints'
  | 'deleteCheckpoint';

/**
 * 存储层错误基类
 *
 * 所有存储相关错误的父类，包含操作名和可选表名。
 */
export class StorageError extends AppError {
  constructor(
    operation: StorageOperation,
    message: string,
    options?: AppErrorOptions & { table?: string }
  ) {
    const { table, ...appOptions } = options ?? {};
    super('STORAGE_ERROR', message, 500, {
      ...appOptions,
      context: {
        operation,
        table,
        ...appOptions?.context,
      },
    });
    this.name = 'StorageError';
  }
}

/**
 * 存储未初始化错误
 *
 * 当存储层未调用 initialize() 就执行操作时抛出。
 * recoverable = true，因为调用 initialize() 后可恢复。
 */
export class StorageNotInitializedError extends StorageError {
  constructor(operation: StorageOperation) {
    super(operation, 'Storage not initialized. Call initialize() first.', {
      recoverable: true,
    });
    this.name = 'StorageNotInitializedError';
  }
}

/**
 * Thread 未找到错误
 *
 * 当查询的 Thread ID 不存在时抛出。
 */
export class ThreadNotFoundError extends AppError {
  constructor(threadId: string) {
    super('THREAD_NOT_FOUND', `Thread not found: ${threadId}`, 404, {
      context: { threadId },
    });
    this.name = 'ThreadNotFoundError';
  }
}

/**
 * Checkpoint 未找到错误
 *
 * 当查询的 Checkpoint ID 不存在时抛出。
 */
export class CheckpointNotFoundError extends AppError {
  constructor(checkpointId: string) {
    super('CHECKPOINT_NOT_FOUND', `Checkpoint not found: ${checkpointId}`, 404, {
      context: { checkpointId },
    });
    this.name = 'CheckpointNotFoundError';
  }
}

/**
 * AgentState 未找到错误
 *
 * 当查询的 AgentState (sessionId + agentName) 不存在时抛出。
 */
export class AgentStateNotFoundError extends AppError {
  constructor(sessionId: string, agentName: string) {
    super('AGENT_STATE_NOT_FOUND', `Agent state not found: ${sessionId}/${agentName}`, 404, {
      context: { sessionId, agentName },
    });
    this.name = 'AgentStateNotFoundError';
  }
}

/**
 * 数据库损坏错误
 *
 * 当检测到数据库数据损坏时抛出。
 * recoverable = false，通常需要重建数据库。
 */
export class DatabaseCorruptionError extends StorageError {
  constructor(
    operation: StorageOperation,
    message: string,
    options?: AppErrorOptions
  ) {
    super(operation, message, {
      ...options,
      recoverable: false,
    });
    this.name = 'DatabaseCorruptionError';
  }
}

/**
 * 数据库写入错误
 *
 * 当数据库写入操作失败时抛出。
 * recoverable = true，写入失败通常可以重试。
 */
export class DatabaseWriteError extends StorageError {
  constructor(
    operation: StorageOperation,
    message: string,
    options?: AppErrorOptions & { table?: string }
  ) {
    super(operation, message, {
      ...options,
      recoverable: true,
    });
    this.name = 'DatabaseWriteError';
  }
}

/**
 * JSON 解析错误（存储层）
 *
 * 当从数据库读取的 JSON 字段解析失败时抛出。
 * recoverable = false，数据已损坏。
 */
export class StorageParseError extends StorageError {
  constructor(
    operation: StorageOperation,
    field: string,
    cause?: Error
  ) {
    super(operation, `Failed to parse JSON field: ${field}`, {
      cause,
      context: { field },
      recoverable: false,
    });
    this.name = 'StorageParseError';
  }
}
