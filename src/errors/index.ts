import { AppError, type AppError as AppErrorType } from './types.js';
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
export type { AppError as AppErrorType };

export function toErrorResponse(error: Error): Response {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status }
    );
  }
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: error.message } },
    { status: 500 }
  );
}
