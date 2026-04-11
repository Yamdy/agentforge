import { AppError } from './types.js';

export {
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
} from './types.js';

export type { AppError as AppErrorType } from './types.js';

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toErrorResponse(err: unknown): { error: { code: string; message: string } } {
  if (isAppError(err)) {
    return err.toJSON();
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  };
}
