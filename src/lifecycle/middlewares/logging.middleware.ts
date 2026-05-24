// ========== Logging Middleware ==========

import type { ToolLifecycleMiddleware } from '../types';

/**
 * Logger interface for logging middleware.
 */
export interface LifecycleLogger {
  debug?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

/**
 * Creates a logging middleware that logs tool execution events.
 *
 * Logs:
 * - Before execution: tool name and arguments
 * - After execution: tool name, duration, and result title
 * - On error: tool name and error message
 *
 * @param logger - Optional logger object (defaults to console)
 * @returns A logging middleware
 *
 * @example
 * ```typescript
 * const manager = new ToolLifecycleManager()
 *   .use(loggingMiddleware())
 * ```
 */
export function loggingMiddleware(
  logger?: LifecycleLogger
): ToolLifecycleMiddleware {
  const log = logger ?? console;

  return async (context, next) => {
    const { tool, args } = context;
    const startTime = Date.now();

    // Log before execution
    log.debug?.(
      `[lifecycle] Tool "${tool.name}" starting`,
      args
    );

    try {
      const result = await next();

      const duration = Date.now() - startTime;

      // Log after execution
      if (result.skipped) {
        log.info?.(
          `[lifecycle] Tool "${tool.name}" skipped after ${duration}ms`
        );
      } else if (result.error) {
        log.warn?.(
          `[lifecycle] Tool "${tool.name}" failed after ${duration}ms:`,
          result.error.message
        );
      } else {
        log.info?.(
          `[lifecycle] Tool "${tool.name}" completed in ${duration}ms`,
          `- ${result.result.title}`
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      log.error?.(
        `[lifecycle] Tool "${tool.name}" threw after ${duration}ms:`,
        err.message
      );

      throw error;
    }
  };
}
