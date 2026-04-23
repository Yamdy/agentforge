// ========== Error Handling Middleware ==========

import type { ToolLifecycleMiddleware, ErrorMiddlewareConfig } from '../types';
import { errorResult } from '../../tool/result';

/**
 * Creates an error handling middleware that catches and transforms errors.
 *
 * If a tool throws an error, this middleware:
 * - Catches the error
 * - Transforms it using the provided transform function or creates an errorResult
 * - Returns a valid ToolResult instead of throwing
 * - Includes stack trace if `includeStack` is true
 *
 * @param config - Error handling configuration
 * @returns An error handling middleware
 *
 * @example
 * ```typescript
 * const manager = new ToolLifecycleManager()
 *   .use(errorMiddleware({
 *     includeStack: true,
 *     transform: (error) => ({
 *       title: 'Custom Error',
 *       output: `Custom: ${error.message}`
 *     })
 *   }))
 * ```
 */
export function errorMiddleware(
  config?: ErrorMiddlewareConfig
): ToolLifecycleMiddleware {
  const { includeStack = false, transform } = config ?? {};

  return async (context, next) => {
    try {
      return await next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Use custom transformer if provided
      if (transform) {
        const result = transform(err, context);
        return {
          result,
          error: err,
        };
      }

      // Default error result
      let output = `Error: ${err.message}`;

      if (includeStack && err.stack) {
        output += `\n\nStack trace:\n${err.stack}`;
      }

      const result = errorResult(err.message);
      if (includeStack && err.stack) {
        result.output = output;
      }

      return {
        result,
        error: err,
      };
    }
  };
}
