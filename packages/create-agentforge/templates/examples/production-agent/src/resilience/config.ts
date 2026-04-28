/**
 * Resilience configuration for production agent (M4).
 *
 * Configures circuit breaker, retry, and timeout settings.
 */

export interface ResilienceConfig {
  /** Maximum number of retries on error */
  maxRetries: number;
  /** Timeout in milliseconds for agent execution */
  timeoutMs: number;
  /** Circuit breaker threshold (failures before opening) */
  circuitBreakerThreshold: number;
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetMs: number;
  /** Initial backoff delay in milliseconds */
  backoffMs: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
}

export const resilienceConfig: ResilienceConfig = {
  maxRetries: 3,
  timeoutMs: 60000, // 60 seconds
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30000, // 30 seconds
  backoffMs: 1000, // 1 second
  maxBackoffMs: 30000, // 30 seconds
};