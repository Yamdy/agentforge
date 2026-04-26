/**
 * Circuit Breaker - MPU-M4 异常熔断
 *
 * Implements circuit breaker pattern with severity-based tripping:
 * - Minor: does not trigger circuit break
 * - Moderate: triggers at threshold
 * - Severe: triggers immediately
 *
 * @module
 */

import type {
  ErrorSeverity,
  CircuitBreakerState,
  CircuitBreakerConfig,
  CircuitBreaker,
} from '../contracts/mpu-interfaces.js';

/**
 * Default circuit breaker implementation.
 *
 * State machine:
 * - closed → open (when threshold reached or severe error)
 * - open → half-open (after reset timeout)
 * - half-open → closed (on success) or open (on failure)
 */
export class DefaultCircuitBreaker implements CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  recordFailure(severity: ErrorSeverity): boolean {
    // Minor errors don't count toward circuit breaking
    if (severity === 'minor') {
      return false;
    }

    // Severe errors trip immediately
    if (severity === 'severe') {
      this.failureCount++;
      this.state = 'open';
      return true;
    }

    // Moderate errors increment and check threshold
    this.failureCount++;
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      return true;
    }

    return false;
  }

  shouldTrip(): boolean {
    return this.state === 'open';
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }
}
