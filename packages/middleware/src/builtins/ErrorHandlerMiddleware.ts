import { Effect } from "effect";
import type {
  Middleware,
  MiddlewareContext,
  MiddlewareNext,
  MiddlewareEventType,
} from "../types";

export interface ErrorHandlerMiddlewareOptions {
  /**
   * 是否捕获所有错误，默认 true
   */
  catchAll?: boolean;
  /**
   * 要处理的错误事件列表
   */
  handledEvents?: MiddlewareEventType[];
  /**
   * 自定义错误处理器
   */
  onError?: (error: unknown, context: MiddlewareContext) => Effect.Effect<MiddlewareContext, never, never>;
  /**
   * 错误日志记录器
   */
  logger?: (error: unknown, context: MiddlewareContext) => void;
}

export function createErrorHandlerMiddleware(
  options: ErrorHandlerMiddlewareOptions = {}
): Middleware {
  const {
    catchAll = true,
    handledEvents,
    onError,
    logger,
  } = options;

  const defaultLogger = (error: unknown, context: MiddlewareContext) => {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${timestamp}] [ERROR] ${context.event}: ${errorMessage}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
  };

  const shouldHandle = (context: MiddlewareContext): boolean => {
    if (!catchAll && !handledEvents) return false;
    if (handledEvents && !handledEvents.includes(context.event)) return false;
    return true;
  };

  return (next: MiddlewareNext) => {
    return (context: MiddlewareContext) => {
      if (!shouldHandle(context)) {
        return next(context);
      }

      return Effect.tryPromise({
        try: async () => {
          try {
            return await Effect.runPromise(next(context));
          } catch (error) {
            // Log the error
            const logFn = logger || defaultLogger;
            logFn(error, context);

            // Use custom error handler if provided
            if (onError) {
              return await Effect.runPromise(onError(error, context));
            }

            // Default: add error to metadata and continue
            return {
              ...context,
              metadata: {
                ...context.metadata,
                error: error instanceof Error ? error.message : String(error),
                errorOccurred: true,
              },
            };
          }
        },
        catch: (e) => {
          // This should not happen as we already caught inside
          return {
            ...context,
            metadata: {
              ...context.metadata,
              error: e instanceof Error ? e.message : String(e),
              errorOccurred: true,
            },
          };
        },
      });
    };
  };
}
