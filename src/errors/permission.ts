/**
 * 权限错误类型
 *
 * 为权限系统提供结构化的错误信息，包含权限类别、输入值、代理名等上下文。
 */

import { AppError, type AppErrorOptions } from './types.js';

/**
 * 权限错误基类
 *
 * 所有权限相关错误的父类。
 */
export class PermissionError extends AppError {
  constructor(
    message: string,
    options?: AppErrorOptions
  ) {
    super('PERMISSION_ERROR', message, 403, options);
    this.name = 'PermissionError';
  }
}

/**
 * 权限被拒绝错误
 *
 * 当操作被权限规则明确拒绝时抛出。
 */
export class PermissionDeniedError extends PermissionError {
  constructor(
    category: string,
    input: string,
    agentName?: string
  ) {
    super(`Permission denied: ${category} "${input}"`, {
      context: { category, input, agentName },
    });
    this.name = 'PermissionDeniedError';
  }
}

/**
 * 权限规则无效错误
 *
 * 当权限规则格式或内容不合法时抛出。
 */
export class InvalidPermissionRuleError extends AppError {
  constructor(rule: string, reason: string) {
    super('INVALID_PERMISSION_RULE', `Invalid permission rule: ${rule}. ${reason}`, 400, {
      context: { rule, reason },
      recoverable: false,
    });
    this.name = 'InvalidPermissionRuleError';
  }
}
