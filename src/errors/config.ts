/**
 * 配置错误类型
 *
 * 为配置加载、解析、验证提供结构化的错误信息。
 */

import { AppError, type AppErrorOptions } from './types.js';

/**
 * 配置错误基类
 *
 * 所有配置相关错误的父类。
 */
export class ConfigError extends AppError {
  constructor(
    message: string,
    options?: AppErrorOptions
  ) {
    super('CONFIG_ERROR', message, 400, options);
    this.name = 'ConfigError';
  }
}

/**
 * 配置文件未找到错误
 *
 * 当指定的配置文件路径不存在时抛出。
 */
export class ConfigNotFoundError extends AppError {
  constructor(configPath: string) {
    super('CONFIG_NOT_FOUND', `Configuration file not found: ${configPath}`, 404, {
      context: { configPath },
    });
    this.name = 'ConfigNotFoundError';
  }
}

/**
 * 配置验证错误
 *
 * 当配置内容不符合 schema 要求时抛出。
 */
export class ConfigValidationError extends ConfigError {
  /** 验证错误详情 */
  public readonly validationErrors: ReadonlyArray<{ field: string; message: string }>;

  constructor(
    message: string,
    errors: readonly { field: string; message: string }[]
  ) {
    super(message, {
      context: { errors },
    });
    this.name = 'ConfigValidationError';
    this.validationErrors = errors;
  }
}

/**
 * 配置解析错误
 *
 * 当配置文件内容无法解析（如 JSON 语法错误）时抛出。
 */
export class ConfigParseError extends ConfigError {
  constructor(configPath: string, cause?: Error) {
    super(`Failed to parse configuration: ${configPath}`, {
      cause,
      context: { configPath },
    });
    this.name = 'ConfigParseError';
  }
}
