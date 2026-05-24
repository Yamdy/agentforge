/**
 * 错误模块
 *
 * 提供统一的错误类型和错误处理工具。
 */

import { AppError } from './types.js';

// ========== 基类导出 ==========
export { AppError } from './types.js';
export type { AppErrorOptions } from './types.js';

// ========== 通用错误导出 ==========
export {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
} from './types.js';

// ========== 存储错误导出 ==========
export {
  StorageError,
  StorageNotInitializedError,
  ThreadNotFoundError,
  CheckpointNotFoundError,
  AgentStateNotFoundError,
  DatabaseCorruptionError,
  DatabaseWriteError,
  StorageParseError,
} from './storage.js';
export type { StorageOperation } from './storage.js';

// ========== 权限错误导出 ==========
export {
  PermissionError,
  PermissionDeniedError,
  InvalidPermissionRuleError,
} from './permission.js';

// ========== 配置错误导出 ==========
export {
  ConfigError,
  ConfigNotFoundError,
  ConfigValidationError,
  ConfigParseError,
} from './config.js';

// ========== Agent 错误导出 ==========
export {
  AgentError,
  AgentMaxStepsError,
  AgentTimeoutError,
  AgentCancelledError,
} from './agent.js';

// ========== 类型守卫和辅助函数导出 ==========
export {
  // 类型守卫
  isAppError,
  isStorageError,
  isPermissionError,
  isConfigError,
  isAgentError,
  isNotFoundError,
  isRecoverable,
  isClientError,
  isServerError,
  // 辅助函数
  toAppError,
  getErrorChain,
  formatErrorMessage,
  toErrorResponse,
} from './guards.js';

// ========== 类型导出 ==========
export type { AppError as AppErrorType } from './types.js';
