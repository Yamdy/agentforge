// ========== Retry Middleware ==========

import type { ToolLifecycleMiddleware, RetryConfig, RetryMetadata } from '../types';

/**
 * Default retry predicate: retry on any error.
 */
const defaultRetryIf = (_error: Error): boolean => true;

/**
 * Sleep with optional abort signal support.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return false;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(true), ms);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    }
  });
}

/**
 * Creates a retry middleware that retries failed tool executions.
 *
 * Implements exponential backoff with configurable delays:
 * - initialDelay: First retry delay (default 1000ms)
 * - backoffFactor: Multiplier for each subsequent retry (default 2)
 * - maxDelay: Maximum delay cap (default 30000ms)
 *
 * Inspired by LangChain's ToolRetryMiddleware.
 *
 * @param config - Retry configuration
 * @returns A retry middleware
 *
 * @example
 * ```typescript
 * const manager = new ToolLifecycleManager()
 *   .use(retryMiddleware({
 *     maxRetries: 3,
 *     initialDelay: 1000,
 *     backoffFactor: 2,
 *     retryIf: (error) => error.message.includes('timeout')
 *   }))
 * ```
 */
export function retryMiddleware(config: RetryConfig): ToolLifecycleMiddleware {
  const {
    maxRetries,
    initialDelay = 1000,
    backoffFactor = 2,
    maxDelay = 30000,
    retryIf = defaultRetryIf,
  } = config;

  // No retries configured
  if (maxRetries <= 0) {
    return async (_context, next) => next();
  }

  return async (context, next) => {
    let lastError: Error | undefined;
    const retryStartTime = Date.now();
    let retriesAttempted = 0;
    let currentDelay = initialDelay;

    // Initial attempt
    context.attempt = 0;

    // Try initial execution
    try {
      const result = await next();

      // Success - add retry metadata showing no retries
      result.metadata = {
        ...result.metadata,
        retry: {
          retries: 0,
          retryDuration: 0,
        } as RetryMetadata,
      };

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    // Check if the initial error is retryable before entering retry loop
    if (!lastError || !retryIf(lastError)) {
      // Not retryable - return error result immediately
      return {
        result: {
          title: 'Error',
          output: `Error: ${lastError?.message ?? 'Unknown error'}`,
        },
        error: lastError,
        metadata: {
          retry: { retries: 0, retryDuration: 0 } as RetryMetadata,
        },
      };
    }

    // Retry loop
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Update attempt number in context
      context.attempt = attempt;

      // Wait before retry
      const slept = await sleep(currentDelay, context.ctx.abort);
      if (!slept) {
        // Aborted during sleep
        break;
      }

      // Update delay for next iteration (exponential backoff)
      currentDelay = Math.min(currentDelay * backoffFactor, maxDelay);

      // Try again
      try {
        const result = await next();

        // Success after retries
        const retryDuration = Date.now() - retryStartTime;
        const retryMetadata: RetryMetadata = {
          retries: attempt,
          retryDuration,
        };

        result.metadata = {
          ...result.metadata,
          retry: retryMetadata,
        };

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retriesAttempted = attempt;

        // Check if this error is retryable
        if (!retryIf(lastError)) {
          break;
        }
      }
    }

    // All retries exhausted or non-retryable error in retry loop
    const retryDuration = Date.now() - retryStartTime;
    const retryMetadata: RetryMetadata = {
      retries: retriesAttempted,
      retryDuration,
    };

    const result = {
      result: {
        title: 'Error',
        output: `Error: ${lastError?.message ?? 'Unknown error'}`,
        metadata: { retry: retryMetadata },
      },
      error: lastError,
      metadata: { retry: retryMetadata },
    };

    // Note: We return the result with error info instead of throwing,
    // allowing error handling middleware to process it
    return result;
  };
}
