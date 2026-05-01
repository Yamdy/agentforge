/**
 * Circuit Breaker - MPU-M4 异常熔断
 *
 * Implements circuit breaker pattern with severity-based tripping
 * and three-state machine (closed → open → half-open → closed).
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
 * - open → half-open (after reset timeout, auto-transition via timer)
 * - half-open → closed (on recordSuccess reaching max attempts)
 * - half-open → open (on any failure)
 */
export class DefaultCircuitBreaker implements CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private readonly config: CircuitBreakerConfig;
  private openSince: number | null = null;
  private halfOpenAttempts = 0;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Record a successful attempt.
   * When state is 'half-open', increments the attempt counter.
   * When attempts >= halfOpenMaxAttempts, transitions to 'closed'.
   *
   * @returns true if state changed from half-open to closed
   */
  recordSuccess(): boolean {
    if (this.state !== 'half-open') {
      return false;
    }

    this.halfOpenAttempts++;

    if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
      this.transitionTo('closed');
      return true;
    }

    return false;
  }

  recordFailure(severity: ErrorSeverity): boolean {
    // Any failure in half-open state immediately re-opens the circuit
    if (this.state === 'half-open') {
      this.transitionTo('open');
      return true;
    }

    // Minor errors don't count toward circuit breaking
    if (severity === 'minor') {
      return false;
    }

    // Severe errors trip immediately
    if (severity === 'severe') {
      this.failureCount++;
      this.transitionTo('open');
      return true;
    }

    // Moderate errors increment and check threshold
    this.failureCount++;
    if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
      return true;
    }

    return false;
  }

  shouldTrip(): boolean {
    return this.state !== 'closed';
  }

  reset(): void {
    this.transitionTo('closed');
  }

  /**
   * Clean up pending timers.
   * Should be called when the circuit breaker is no longer needed.
   */
  destroy(): void {
    this.clearTimer();
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Transition the state machine to a new state, handling side effects.
   */
  private transitionTo(newState: CircuitBreakerState): void {
    // Allow forced transition to 'closed' even when already closed (for reset())
    if (this.state === newState && newState !== 'closed') {
      return;
    }

    // Always clear previous timer before setting a new one
    this.clearTimer();

    // closed → open
    if (this.state === 'closed' && newState === 'open') {
      this.openSince = Date.now();
      this.resetTimer = setTimeout(() => {
        if (this.openSince !== null) {
          this.transitionTo('half-open');
        }
      }, this.config.resetTimeoutMs);
    }
    // open → half-open (auto-transition from timer)
    else if (this.state === 'open' && newState === 'half-open') {
      this.openSince = null;
      this.halfOpenAttempts = 0;
    }
    // half-open → closed (success threshold reached)
    else if (this.state === 'half-open' && newState === 'closed') {
      this.failureCount = 0;
      this.openSince = null;
      this.halfOpenAttempts = 0;
    }
    // half-open → open (failure during probation)
    else if (this.state === 'half-open' && newState === 'open') {
      this.failureCount++;
      this.openSince = Date.now();
      this.resetTimer = setTimeout(() => {
        if (this.openSince !== null) {
          this.transitionTo('half-open');
        }
      }, this.config.resetTimeoutMs);
    }
    // Any state → closed (including closed→closed for reset())
    else if (newState === 'closed') {
      this.failureCount = 0;
      this.openSince = null;
      this.halfOpenAttempts = 0;
    }

    this.state = newState;
  }

  private clearTimer(): void {
    if (this.resetTimer !== null) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
