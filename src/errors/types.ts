export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super('NOT_FOUND', message, 404);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
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
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
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
