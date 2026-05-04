/**
 * Unit tests for GracefulShutdown
 *
 * Tests ordered cleanup execution with timeout support.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GracefulShutdown } from '../../src/lifecycle/graceful-shutdown.js';

// ============================================================
// GracefulShutdown Tests
// ============================================================

describe('GracefulShutdown', () => {
  let shutdown: GracefulShutdown;

  beforeEach(() => {
    shutdown = new GracefulShutdown();
  });

  // ----------------------------------------------------------
    // ----------------------------------------------------------

  describe('registerCleanup', () => {
    it('should register cleanup function', () => {
      const handler = async () => {};
      shutdown.registerCleanup('cleanup-1', handler);
      // No error means registration succeeded
      // We'll verify it runs in the shutdown tests
      expect(true).toBe(true);
    });

    it('should throw on duplicate name', () => {
      shutdown.registerCleanup('cleanup-1', async () => {});
      expect(() => {
        shutdown.registerCleanup('cleanup-1', async () => {});
      }).toThrow();
    });
  });

  // ----------------------------------------------------------
    // ----------------------------------------------------------

  describe('shutdown', () => {
    it('should execute all cleanup functions', async () => {
      const order: string[] = [];

      shutdown.registerCleanup('first', async () => {
        order.push('first');
      });
      shutdown.registerCleanup('second', async () => {
        order.push('second');
      });
      shutdown.registerCleanup('third', async () => {
        order.push('third');
      });

      const result = await shutdown.shutdown(5000);

      expect(result.success).toBe(true);
      expect(result.completedCleanups).toEqual(['first', 'second', 'third']);
      expect(result.failedCleanups).toEqual([]);
      expect(order).toEqual(['first', 'second', 'third']);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should report failed cleanups', async () => {
      shutdown.registerCleanup('good', async () => {});
      shutdown.registerCleanup('bad', async () => {
        throw new Error('cleanup failed');
      });

      const result = await shutdown.shutdown(5000);

      expect(result.success).toBe(false);
      expect(result.completedCleanups).toEqual(['good']);
      expect(result.failedCleanups).toEqual(['bad']);
    });

    // ----------------------------------------------------------
        // ----------------------------------------------------------

    it('should force exit on timeout', async () => {
      vi.useFakeTimers();

      shutdown.registerCleanup('fast', async () => {});
      shutdown.registerCleanup('slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
      });

      const resultPromise = shutdown.shutdown(100);
      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      // Drain the abandoned 5000ms timer from the slow cleanup
      await vi.runAllTimersAsync();
      vi.useRealTimers();

      expect(result.success).toBe(false);
      expect(result.completedCleanups).toEqual(['fast']);
      expect(result.failedCleanups).toEqual(['slow']);
      expect(result.durationMs).toBeLessThan(5000);
    });
  });

  // ----------------------------------------------------------
    // ----------------------------------------------------------

  describe('isShuttingDown', () => {
    it('should return true when shutting down', async () => {
      expect(shutdown.isShuttingDown()).toBe(false);

      shutdown.registerCleanup('blocker', async () => {
        // Check during shutdown execution
        expect(shutdown.isShuttingDown()).toBe(true);
      });

      await shutdown.shutdown(5000);
      expect(shutdown.isShuttingDown()).toBe(true);
    });
  });

  // ----------------------------------------------------------
    // ----------------------------------------------------------

  describe('onShutdown', () => {
    it('should register shutdown callback', async () => {
      let callbackCalled = false;

      shutdown.onShutdown(() => {
        callbackCalled = true;
      });

      await shutdown.shutdown(5000);
      expect(callbackCalled).toBe(true);
    });

    it('should call multiple callbacks', async () => {
      const calls: string[] = [];

      shutdown.onShutdown(() => { calls.push('a'); });
      shutdown.onShutdown(() => { calls.push('b'); });

      await shutdown.shutdown(5000);
      expect(calls).toEqual(['a', 'b']);
    });
  });
});
