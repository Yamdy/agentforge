/**
 * AppError 构造选项
 */
export interface AppErrorOptions {
  /** 是否可恢复（重试可能成功） */
  recoverable?: boolean;
  /** 原始错误（用于错误链追踪） */
  cause?: Error;
  /** 额外上下文信息 */
  context?: Record<string, unknown>;
}

/**
 * 应用错误基类
 *
 * @example
 * ```typescript
 * throw new AppError('CONFIG_ERROR', 'Invalid configuration', 500, {
 *   recoverable: false,
 *   context: { configPath: '/path/to/config.json' }
 * })
 * ```
 */
export class AppError extends Error {
  public readonly timestamp: Date;
  public readonly options?: AppErrorOptions;

  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 500,
    options?: AppErrorOptions
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.timestamp = new Date();
    this.options = options;
  }

  /** 是否可恢复 */
  get recoverable(): boolean {
    return this.options?.recoverable ?? false;
  }

  /** 获取上下文信息 */
  get context(): Record<string, unknown> | undefined {
    return this.options?.context;
  }

  /** 获取原始错误链 */
  get causeChain(): Error | undefined {
    return this.options?.cause;
  }

  toJSON(): {
    error: {
      code: string;
      message: string;
      status: number;
      recoverable: boolean;
      timestamp: string;
      context?: Record<string, unknown>;
    };
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
        recoverable: this.recoverable,
        timestamp: this.timestamp.toISOString(),
        context: this.context,
      },
    };
  }

  /** 格式化为可读字符串 */
  toString(): string {
    const parts = [`[${this.code}] ${this.message}`];
    if (this.context) {
      parts.push(`Context: ${JSON.stringify(this.context)}`);
    }
    if (this.options?.cause) {
      parts.push(`Caused by: ${this.options.cause.message}`);
    }
    return parts.join('\n');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request') {
    super('BAD_REQUEST', message, 400);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    public errors?: { field: string; message: string }[]
  ) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }

  toJSON(): { error: { code: string; message: string; status: number; recoverable: boolean; timestamp: string; context?: Record<string, unknown>; details?: { field: string; message: string }[] } } {
    const base = super.toJSON();
    if (this.errors && this.errors.length > 0) {
      return { error: { ...base.error, details: this.errors } };
    }
    return base;
  }
}

export class ToolNotFoundError extends AppError {
  constructor(toolName: string) {
    super('TOOL_NOT_FOUND', `Tool not found: ${toolName}`, 404);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolExecuteError extends AppError {
  constructor(toolName: string, message: string) {
    super('TOOL_EXECUTE_ERROR', `Tool ${toolName} failed: ${message}`, 500);
    this.name = 'ToolExecuteError';
  }
}

export class LLMError extends AppError {
  constructor(message: string) {
    super('LLM_ERROR', message, 500);
    this.name = 'LLMError';
  }
}
