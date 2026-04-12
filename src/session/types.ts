import type { TaskState } from '../types.js';

/**
 * 会话消息
 */
export interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
}

/**
 * 待执行的工具调用
 */
export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * 检查点
 */
export interface Checkpoint {
  /** 检查点 ID */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** Agent 执行步骤索引 */
  stepIndex: number;
  /** 消息快照 */
  messages: SessionMessage[];
  /** 待执行的工具调用 */
  toolCalls: PendingToolCall[];
  /** Agent 状态 */
  state: TaskState;
  /** 创建时间 */
  createdAt: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 会话配置
 */
export interface SessionConfig {
  /** 自动创建检查点 */
  autoCheckpoint?: boolean;
  /** 检查点间隔（步数） */
  checkpointInterval?: number;
  /** 自动压缩 */
  autoCompact?: boolean;
  /** 最大消息数 */
  maxMessages?: number;
}
