export {
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ValidationError,
  ToolNotFoundError,
  ToolExecuteError,
  LLMError,
  isAppError,
  toErrorResponse,
} from '../errors/index.js';

export type { AppError as AppErrorType } from '../errors/index.js';

export const ErrorCodes = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;
