export interface AgentErrorOptions {
  code: string;
  recoverable?: boolean;
  retryCount?: number;
  maxRetries?: number;
  cause?: Error;
}

export class AgentForgeError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly retryCount?: number;
  readonly maxRetries?: number;

  constructor(message: string, options: AgentErrorOptions) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.recoverable = options.recoverable ?? false;
    this.retryCount = options.retryCount;
    this.maxRetries = options.maxRetries;
  }
}

export class RecoverableError extends AgentForgeError {
  constructor(message: string, options: Omit<AgentErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: true });
  }
}

export class FatalError extends AgentForgeError {
  constructor(message: string, options: Omit<AgentErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: false });
  }
}

export class AuthError extends FatalError {
  constructor(message: string, cause?: Error) {
    super(message, { code: 'AUTH', cause });
  }
}

export class ModelNotFoundError extends FatalError {
  constructor(modelString: string, cause?: Error) {
    super(`Model not found: "${modelString}"`, { code: 'MODEL_NOT_FOUND', cause });
  }
}

export class ToolExecutionError extends RecoverableError {
  constructor(message: string, cause?: Error) {
    super(message, { code: 'TOOL_ERROR', cause });
  }
}
