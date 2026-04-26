/**
 * Unit tests for src/resilience/circuit-breaker.ts
 *
 * Tests circuit breaker logic:
 * - Minor: does not trigger circuit break
 * - Moderate: triggers at threshold
 * - Severe: triggers immediately
 */

import { describe, it, expect } from 'vitest';
import { DefaultCircuitBreaker } from '../../src/resilience/circuit-breaker.js';

describe('DefaultCircuitBreaker', () => {
  // ============================================================
  // Initial state
  // ============================================================

  describe('initial state', () => {
    it('should start in closed state', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      expect(cb.getState()).toBe('closed');
    });

    it('should start with zero failure count', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      expect(cb.getFailureCount()).toBe(0);
    });

    it('should not trip initially', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      expect(cb.shouldTrip()).toBe(false);
    });
  });

  // ============================================================
  // Minor errors - no circuit break
  // ============================================================

  describe('minor errors', () => {
    it('should not increment failure count for minor errors', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('minor');
      expect(cb.getFailureCount()).toBe(0);
    });

    it('should not trip after many minor errors', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      for (let i = 0; i < 10; i++) {
        cb.recordFailure('minor');
      }
      expect(cb.getState()).toBe('closed');
      expect(cb.shouldTrip()).toBe(false);
    });

    it('should return false when recording minor failure', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      expect(cb.recordFailure('minor')).toBe(false);
    });
  });

  // ============================================================
  // Moderate errors - trigger at threshold
  // ============================================================

  describe('moderate errors', () => {
    it('should increment failure count for moderate errors', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('moderate');
      expect(cb.getFailureCount()).toBe(1);
    });

    it('should not trip below threshold', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('moderate');
      cb.recordFailure('moderate');
      expect(cb.getState()).toBe('closed');
      expect(cb.shouldTrip()).toBe(false);
    });

    it('should trip at threshold', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('moderate');
      cb.recordFailure('moderate');
      const tripped = cb.recordFailure('moderate');
      expect(tripped).toBe(true);
      expect(cb.getState()).toBe('open');
      expect(cb.shouldTrip()).toBe(true);
    });

    it('should return false when below threshold', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      expect(cb.recordFailure('moderate')).toBe(false);
      expect(cb.recordFailure('moderate')).toBe(false);
      expect(cb.recordFailure('moderate')).toBe(false);
      expect(cb.recordFailure('moderate')).toBe(false);
      expect(cb.recordFailure('moderate')).toBe(true);
    });
  });

  // ============================================================
  // Severe errors - immediate trigger
  // ============================================================

  describe('severe errors', () => {
    it('should trip immediately on severe error', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      const tripped = cb.recordFailure('severe');
      expect(tripped).toBe(true);
      expect(cb.getState()).toBe('open');
    });

    it('should trip immediately even with zero prior failures', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 10, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      expect(cb.getFailureCount()).toBe(0);
      cb.recordFailure('severe');
      expect(cb.getState()).toBe('open');
    });
  });

  // ============================================================
  // Reset
  // ============================================================

  describe('reset', () => {
    it('should reset to closed state', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('severe');
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('should reset failure count', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('moderate');
      cb.recordFailure('moderate');
      cb.reset();
      expect(cb.getFailureCount()).toBe(0);
    });
  });

  // ============================================================
  // Mixed severity
  // ============================================================

  describe('mixed severity', () => {
    it('should count moderate and severe together', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('moderate');
      cb.recordFailure('moderate');
      // Third failure is severe - should trip
      const tripped = cb.recordFailure('severe');
      expect(tripped).toBe(true);
      expect(cb.getState()).toBe('open');
    });

    it('should not count minor toward threshold', () => {
      const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000, halfOpenMaxAttempts: 1 });
      cb.recordFailure('minor');
      cb.recordFailure('minor');
      cb.recordFailure('moderate');
      cb.recordFailure('moderate');
      // Only 2 moderate failures, threshold is 3
      expect(cb.getState()).toBe('closed');
      expect(cb.shouldTrip()).toBe(false);
    });
  });
});
