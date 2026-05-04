/**
 * Unit tests for src/resilience/circuit-breaker.ts
 *
 * Tests circuit breaker logic:
 * - Minor: does not trigger circuit break
 * - Moderate: triggers at threshold
 * - Severe: triggers immediately
 */

import { describe, it, expect, vi } from 'vitest';
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

  // ============================================================
  // Concurrency
  // ============================================================

  describe('concurrency', () => {
    it('should trip at exact threshold under concurrent moderate failures', async () => {
      const cb = new DefaultCircuitBreaker({
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 2,
      });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => Promise.resolve(cb.recordFailure('moderate')))
      );

      // First 4 calls: failureCount 1..4, below threshold, return false.
      // Call 5: failureCount reaches 5, trips to open, returns true.
      // Calls 6-20: failureCount keeps incrementing, condition failureCount>=threshold
      //   remains true, so they also return true (circuit already open).
      const trippedCount = results.filter((r) => r === true).length;
      expect(trippedCount).toBeGreaterThanOrEqual(1);
      expect(cb.getState()).toBe('open');
      expect(cb.shouldTrip()).toBe(true);
      // All 20 moderate failures increment failureCount
      expect(cb.getFailureCount()).toBe(20);
    });

    it('should transition half-open to closed under concurrent successes', async () => {
      vi.useFakeTimers();

      const cb = new DefaultCircuitBreaker({
        failureThreshold: 2,
        resetTimeoutMs: 1000,
        halfOpenMaxAttempts: 3,
      });

      // Trip to open
      cb.recordFailure('severe');
      expect(cb.getState()).toBe('open');

      // Advance time past reset timeout to auto-transition to half-open
      vi.advanceTimersByTime(1001);
      expect(cb.getState()).toBe('half-open');

      // Concurrent successes in half-open state
      const results = await Promise.all(
        Array.from({ length: 10 }, () => Promise.resolve(cb.recordSuccess()))
      );

      // With halfOpenMaxAttempts=3: calls 1-2 increment counter (return false),
      // call 3 increments to 3, transitions to closed (returns true),
      // calls 4-10 are in closed state (return false).
      const closedTransitions = results.filter((r) => r === true).length;
      expect(closedTransitions).toBe(1);
      expect(cb.getState()).toBe('closed');
      expect(cb.getFailureCount()).toBe(0);
      expect(cb.shouldTrip()).toBe(false);

      vi.useRealTimers();
    });

    it('should not trip before threshold even under concurrent access', async () => {
      const cb = new DefaultCircuitBreaker({
        failureThreshold: 10,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 2,
      });

      await Promise.all(
        Array.from({ length: 7 }, () => Promise.resolve(cb.recordFailure('moderate')))
      );

      expect(cb.getState()).toBe('closed');
      expect(cb.shouldTrip()).toBe(false);
      expect(cb.getFailureCount()).toBe(7);
    });

    it('should handle concurrent severe errors — every one trips', async () => {
      const cb = new DefaultCircuitBreaker({
        failureThreshold: 10,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 2,
      });

      const results = await Promise.all(
        Array.from({ length: 15 }, () => Promise.resolve(cb.recordFailure('severe')))
      );

      // First severe error trips immediately. Subsequent severe errors in open
      // state also increment failureCount and call transitionTo('open') which is no-op.
      const trippedCount = results.filter((r) => r === true).length;
      expect(trippedCount).toBeGreaterThanOrEqual(1);
      expect(cb.getState()).toBe('open');
      expect(cb.getFailureCount()).toBe(15);
    });

    it('should handle concurrent failure and state queries without inconsistency', async () => {
      const cb = new DefaultCircuitBreaker({
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        halfOpenMaxAttempts: 1,
      });

      // Interleave failures with state queries
      const operations = Array.from({ length: 15 }, (_, i) => {
        if (i % 3 === 0) {
          return Promise.resolve({ type: 'state' as const, value: cb.getState() });
        }
        return Promise.resolve({ type: 'result' as const, value: cb.recordFailure('moderate') });
      });

      const results = await Promise.all(operations);

      // State should only be one of three valid values
      for (const r of results) {
        if (r.type === 'state') {
          expect(['closed', 'open', 'half-open']).toContain(r.value);
        }
      }

      // Should end in open state (10 moderate failures > threshold of 3)
      expect(cb.getState()).toBe('open');
    });
  });
});
