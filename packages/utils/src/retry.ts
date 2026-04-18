import { Effect, Schedule } from 'effect';

/**
 * Retry policy configuration
 */
export interface RetryConfig {
  readonly maxRetries: number;
  readonly delayMs?: number;
  readonly exponentialBackoff?: boolean;
}

/**
 * Retry an effect with configurable backoff
 */
export function retry<T, E, R>(
  effect: Effect.Effect<T, E, R>,
  config: RetryConfig
): Effect.Effect<T, E, R> {
  return Effect.retry(effect, Schedule.recurs(config.maxRetries));
}

/**
 * Retry a synchronous function with configurable backoff
 */
export function retrySync<T>(
  fn: () => T,
  config: RetryConfig
): T {
  const { maxRetries, delayMs = 1000, exponentialBackoff = false } = config;
  let lastError: unknown;
  let delay = delayMs;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        if (exponentialBackoff) {
          delay *= 2;
        }
        // eslint-disable-next-line
        const start = Date.now();
        while (Date.now() - start < delay) {
          // busy wait for sync retry
        }
      }
    }
  }
  
  throw lastError;
}
