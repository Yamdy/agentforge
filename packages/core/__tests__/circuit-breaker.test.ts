import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  describe('state transitions', () => {
    it('starts in Closed state', () => {
      breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 10000 });
      expect(breaker.state).toBe('closed');
    });

    it('stays Closed when failures are below threshold', () => {
      breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 10000 });
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.state).toBe('closed');
    });

    it('transitions Closed→Open when failures reach threshold', () => {
      breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 10000 });

      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.state).toBe('open');
    });

    it('transitions Open→HalfOpen after resetTimeout', () => {
      breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 5000 });

      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.state).toBe('open');

      vi.advanceTimersByTime(5000);
      expect(breaker.state).toBe('half_open');
    });

    it('transitions HalfOpen→Closed on recordSuccess', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });

      breaker.recordFailure();
      expect(breaker.state).toBe('open');

      vi.advanceTimersByTime(1000);
      expect(breaker.state).toBe('half_open');

      breaker.recordSuccess();
      expect(breaker.state).toBe('closed');
    });

    it('transitions HalfOpen→Open on recordFailure', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });

      breaker.recordFailure();
      expect(breaker.state).toBe('open');

      vi.advanceTimersByTime(1000);
      expect(breaker.state).toBe('half_open');

      breaker.recordFailure();
      expect(breaker.state).toBe('open');
    });

    it('reset() forces Open→Closed immediately', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      breaker.recordFailure();
      expect(breaker.state).toBe('open');

      breaker.reset();
      expect(breaker.state).toBe('closed');
    });
  });

  // ---------------------------------------------------------------------------
  // Call gating
  // ---------------------------------------------------------------------------

  describe('call gating', () => {
    it('checkBeforeCall returns true when Closed', () => {
      breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 10000 });
      expect(breaker.checkBeforeCall()).toBe(true);
    });

    it('checkBeforeCall returns false when Open', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      breaker.recordFailure();
      expect(breaker.checkBeforeCall()).toBe(false);
    });

    it('checkBeforeCall permits up to halfOpenMaxRequests in HalfOpen', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenMaxRequests: 2 });

      breaker.recordFailure();
      vi.advanceTimersByTime(1000);
      expect(breaker.state).toBe('half_open');

      expect(breaker.checkBeforeCall()).toBe(true);
      expect(breaker.checkBeforeCall()).toBe(true);
      expect(breaker.checkBeforeCall()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  describe('events', () => {
    it('emits circuit:opened when transitioning to Open', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      const handler = vi.fn();
      breaker.on('circuit:opened', handler);

      breaker.recordFailure();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ failureCount: 1 });
    });

    it('emits circuit:half_open when entering HalfOpen', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000 });
      const handler = vi.fn();
      breaker.on('circuit:half_open', handler);

      breaker.recordFailure();
      vi.advanceTimersByTime(1000);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits circuit:closed when resetting to Closed', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      const handler = vi.fn();
      breaker.on('circuit:closed', handler);

      breaker.recordFailure();
      breaker.reset();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits circuit:rejected when checkBeforeCall blocked', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      const handler = vi.fn();
      breaker.on('circuit:rejected', handler);

      breaker.recordFailure();
      breaker.checkBeforeCall();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ reason: 'circuit_open' });
    });

    it('supports unsubscribe via returned function', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      const handler = vi.fn();
      const unsub = breaker.on('circuit:opened', handler);
      unsub();

      breaker.recordFailure();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Configuration validation
  // ---------------------------------------------------------------------------

  describe('configuration validation', () => {
    it('uses sensible defaults', () => {
      breaker = new CircuitBreaker();
      expect(breaker.state).toBe('closed');
      for (let i = 0; i < 4; i++) breaker.recordFailure();
      expect(breaker.state).toBe('closed');
      breaker.recordFailure(); // 5th
      expect(breaker.state).toBe('open');
    });

    it('throws on negative failureThreshold', () => {
      expect(() => new CircuitBreaker({ failureThreshold: -1 })).toThrow();
    });

    it('throws on zero resetTimeout', () => {
      expect(() => new CircuitBreaker({ failureThreshold: 1, resetTimeout: 0 })).toThrow();
    });

    it('throws on zero halfOpenMaxRequests', () => {
      expect(() => new CircuitBreaker({ failureThreshold: 1, resetTimeout: 1000, halfOpenMaxRequests: 0 })).toThrow();
    });

    it('accepts failureThreshold of 0', () => {
      breaker = new CircuitBreaker({ failureThreshold: 0, resetTimeout: 10000 });
      breaker.recordFailure();
      expect(breaker.state).toBe('open');
    });
  });

  // ---------------------------------------------------------------------------
  // Snapshot for persistence
  // ---------------------------------------------------------------------------

  describe('snapshot', () => {
    it('exports Closed state with failure count', () => {
      breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 30000 });
      breaker.recordFailure();
      breaker.recordFailure();

      const snap = breaker.snapshot();
      expect(snap.state).toBe('closed');
      expect(snap.failureCount).toBe(2);
    });

    it('exports Open state with openedAt timestamp', () => {
      breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 10000 });
      breaker.recordFailure();
      breaker.recordFailure();

      const snap = breaker.snapshot();
      expect(snap.state).toBe('open');
      expect(snap.openedAt).toBeGreaterThan(0);
    });

    it('fromSnapshot restores Closed with correct failure count', () => {
      const restored = CircuitBreaker.fromSnapshot({
        state: 'closed',
        failureCount: 3,
        failureThreshold: 5,
        resetTimeout: 30000,
      });
      expect(restored.state).toBe('closed');
      expect(restored.snapshot().failureCount).toBe(3);
    });

    it('fromSnapshot restores Open preserving openedAt', () => {
      const now = Date.now();
      const restored = CircuitBreaker.fromSnapshot({
        state: 'open',
        failureCount: 3,
        failureThreshold: 3,
        resetTimeout: 10000,
        openedAt: now,
      });
      expect(restored.state).toBe('open');
      expect(restored.snapshot().openedAt).toBe(now);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('destroy() clears pending timer', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      breaker.recordFailure();
      expect(breaker.state).toBe('open');

      breaker.destroy();
      vi.advanceTimersByTime(15000);
      expect(breaker.state).toBe('open'); // timer cleared, no transition
    });

    it('reset() clears pending timer', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      breaker.recordFailure();
      breaker.reset();
      expect(breaker.state).toBe('closed');

      vi.advanceTimersByTime(15000);
      expect(breaker.state).toBe('closed'); // timer cleared
    });

    it('recordFailure is a no-op when already Open (no double-open)', () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      const handler = vi.fn();
      breaker.on('circuit:opened', handler);

      breaker.recordFailure();
      expect(handler).toHaveBeenCalledTimes(1);

      breaker.recordFailure(); // already open
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
