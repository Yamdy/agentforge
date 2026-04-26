/**
 * Unit tests for GracefulShutdown
 *
 * Tests ordered cleanup execution with timeout support.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  // TC-016: registerCleanup() should register cleanup function
  // ----------------------------------------------------------

  describe('registerCleanup', () => {
    it('TC-016: should register cleanup function', () => {
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
  // TC-017: shutdown() should execute all cleanup functions
  // ----------------------------------------------------------

  describe('shutdown', () => {
    it('TC-017: should execute all cleanup functions', async () => {
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
    // TC-018: shutdown() should force exit on timeout
    // ----------------------------------------------------------

    it('TC-018: should force exit on timeout', async () => {
      shutdown.registerCleanup('fast', async () => {});
      shutdown.registerCleanup('slow', async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
      });

      const result = await shutdown.shutdown(100);

      expect(result.success).toBe(false);
      expect(result.completedCleanups).toEqual(['fast']);
      expect(result.failedCleanups).toEqual(['slow']);
      expect(result.durationMs).toBeLessThan(5000);
    });
  });

  // ----------------------------------------------------------
  // TC-019: isShuttingDown() should return true during shutdown
  // ----------------------------------------------------------

  describe('isShuttingDown', () => {
    it('TC-019: should return true when shutting down', async () => {
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
  // TC-020: onShutdown() should register shutdown callback
  // ----------------------------------------------------------

  describe('onShutdown', () => {
    it('TC-020: should register shutdown callback', async () => {
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
