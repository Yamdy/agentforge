// ========== Timing Middleware ==========

import type { ToolLifecycleMiddleware, TimingMetadata } from '../types';

/**
 * Creates a timing middleware that tracks execution duration.
 *
 * Adds timing metadata to the result:
 * - `result.metadata.timing.startTime` - Start time in ms since epoch
 * - `result.metadata.timing.duration` - Execution duration in ms
 *
 * @returns A timing middleware
 *
 * @example
 * ```typescript
 * const manager = new ToolLifecycleManager()
 *   .use(timingMiddleware())
 * ```
 */
export function timingMiddleware(): ToolLifecycleMiddleware {
  return async (context, next) => {
    const startTime = Date.now();

    // Execute the chain
    const result = await next();

    const duration = Date.now() - startTime;

    // Add timing metadata
    const timing: TimingMetadata = {
      startTime,
      duration,
    };

    // Merge with existing metadata
    result.metadata = {
      ...result.metadata,
      timing,
    };

    return result;
  };
}
