/**
 * 错误类型守卫和辅助函数
 *
 * 提供类型安全的错误检测和转换工具。
 */

import { AppError } from './types.js';
import { StorageError } from './storage.js';
import { PermissionError } from './permission.js';
import { ConfigError } from './config.js';
import { AgentError } from './agent.js';

// ========== 类型守卫 ==========

/**
 * 检查是否为 AppError
 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * 检查是否为存储错误
 */
export function isStorageError(err: unknown): err is StorageError {
  return err instanceof StorageError;
}

/**
 * 检查是否为权限错误
 */
export function isPermissionError(err: unknown): err is PermissionError {
  return err instanceof PermissionError;
}

/**
 * 检查是否为配置错误
 */
export function isConfigError(err: unknown): err is ConfigError {
  return err instanceof ConfigError;
}

/**
 * 检查是否为 Agent 错误
 */
export function isAgentError(err: unknown): err is AgentError {
  return err instanceof AgentError;
}

/**
 * 检查是否为 404 错误
 */
export function isNotFoundError(err: unknown): err is AppError {
  return isAppError(err) && err.status === 404;
}

/**
 * 检查是否为可恢复错误
 */
export function isRecoverable(err: unknown): boolean {
  return isAppError(err) && err.recoverable;
}

/**
 * 检查是否为客户端错误 (4xx)
 */
export function isClientError(err: unknown): boolean {
  return isAppError(err) && err.status >= 400 && err.status < 500;
}

/**
 * 检查是否为服务端错误 (5xx)
 */
export function isServerError(err: unknown): boolean {
  return isAppError(err) && err.status >= 500;
}

// ========== 辅助函数 ==========

/**
 * 将任意错误转换为 AppError
 *
 * @param err - 任意错误对象
 * @returns AppError 实例
 */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err : undefined;

  return new AppError('INTERNAL_ERROR', message, 500, { cause });
}

/**
 * 获取错误链（从 cause 向上追溯）
 *
 * @param err - 起始错误
 * @returns 错误链数组，从最外层到最内层
 */
export function getErrorChain(err: Error): Error[] {
  const chain: Error[] = [err];
  let current: Error | undefined = err;

  // Use causeChain (AppError) or cause (native Error)
  while (current) {
    let cause: Error | undefined;
    if (current instanceof AppError) {
      cause = current.causeChain;
    } else {
      cause = (current as Error & { cause?: Error }).cause;
    }

    if (cause instanceof Error) {
      chain.push(cause);
      current = cause;
    } else {
      break;
    }
  }

  return chain;
}

/**
 * 格式化错误为用户友好的消息
 *
 * @param err - 错误对象
 * @returns 格式化的错误消息
 */
export function formatErrorMessage(err: unknown): string {
  if (!isAppError(err)) {
    return err instanceof Error ? err.message : String(err);
  }

  const parts: string[] = [`[${err.code}] ${err.message}`];

  if (err.context && Object.keys(err.context).length > 0) {
    parts.push(`Context: ${JSON.stringify(err.context)}`);
  }

  if (err.causeChain) {
    parts.push(`Caused by: ${err.causeChain.message}`);
  }

  return parts.join('\n');
}

/**
 * 创建错误响应对象（用于 HTTP/API 响应）
 *
 * @param err - 错误对象
 * @returns 标准化的错误响应
 */
export function toErrorResponse(err: unknown): {
  error: {
    code: string;
    message: string;
    status: number;
    recoverable: boolean;
    timestamp?: string;
    context?: Record<string, unknown>;
  };
} {
  if (isAppError(err)) {
    return err.toJSON();
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message,
      status: 500,
      recoverable: false,
    },
  };
}
