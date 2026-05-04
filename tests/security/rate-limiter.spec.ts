/**
 * InMemoryRateLimiter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryRateLimiter,
  DEFAULT_RATE_LIMITS,
} from '../../src/security/rate-limit/rate-limiter.js';
import type { RateLimitConfig } from '../../src/security/rate-limit/rate-limiter.js';

describe('InMemoryRateLimiter', () => {
  let limiter: InMemoryRateLimiter;
  const config: RateLimitConfig = { maxRequests: 3, windowMs: 1000 };

  beforeEach(() => {
    limiter = new InMemoryRateLimiter();
    vi.useRealTimers();
  });

  describe('check()', () => {
    it('should allow requests when under limit', () => {
      expect(limiter.check('key1', config)).toBe(true);
    });

    it('should allow requests when at limit', () => {
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(false);
    });

    it('should allow requests for different keys independently', () => {
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      expect(limiter.check('key2', config)).toBe(true);
    });

    it('should reset after window expires', () => {
      vi.useFakeTimers();
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(false);

      vi.advanceTimersByTime(1001);
      expect(limiter.check('key1', config)).toBe(true);
    });
  });

  describe('consume()', () => {
    it('should increment count', () => {
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(true); // 1 < 3
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(true); // 2 < 3
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(false); // 3 >= 3
    });

    it('should create new entry for previously unseen key', () => {
      limiter.consume('new-key', config);
      const entry = (limiter as any).entries.get('new-key');
      expect(entry).toBeDefined();
      expect(entry.count).toBe(1);
      expect(entry.windowStart).toBeGreaterThan(0);
    });

    it('should reset count after window expires via consume', () => {
      vi.useFakeTimers();
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(true);  // 2 < 3

      vi.advanceTimersByTime(1001);
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(true);  // window expired, count reset to 1
    });
  });

  describe('reset()', () => {
    it('should clear the entry', () => {
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(false);

      limiter.reset('key1');
      expect(limiter.check('key1', config)).toBe(true);
    });

    it('should not throw for non-existent key', () => {
      expect(() => limiter.reset('nonexistent')).not.toThrow();
    });
  });

  describe('DEFAULT_RATE_LIMITS', () => {
    it('should define perSession limit', () => {
      expect(DEFAULT_RATE_LIMITS.perSession).toEqual({
        maxRequests: 100,
        windowMs: 60000,
      });
    });

    it('should define global limit', () => {
      expect(DEFAULT_RATE_LIMITS.global).toEqual({
        maxRequests: 1000,
        windowMs: 60000,
      });
    });

    it('should have empty perTool map', () => {
      expect(DEFAULT_RATE_LIMITS.perTool).toEqual({});
    });
  });

  describe('cleanup behavior', () => {
    it('should clean stale entry on next check', () => {
      vi.useFakeTimers();
      limiter.consume('key1', config);
      expect(limiter.check('key1', config)).toBe(true); // 1 < 3

      vi.advanceTimersByTime(1001);
      // Window expired, entry should be cleaned on next check
      expect(limiter.check('key1', config)).toBe(true);
    });

    it('should allow maxRequests=1 config', () => {
      const strictConfig: RateLimitConfig = { maxRequests: 1, windowMs: 60000 };
      expect(limiter.check('key1', strictConfig)).toBe(true);
      limiter.consume('key1', strictConfig);
      expect(limiter.check('key1', strictConfig)).toBe(false);
    });

    it('should track different configs for different keys independently', () => {
      const shortConfig: RateLimitConfig = { maxRequests: 2, windowMs: 100 };
      const longConfig: RateLimitConfig = { maxRequests: 5, windowMs: 10000 };

      limiter.consume('short', shortConfig);
      limiter.consume('short', shortConfig);
      expect(limiter.check('short', shortConfig)).toBe(false);

      limiter.consume('long', longConfig);
      expect(limiter.check('long', longConfig)).toBe(true); // 1 < 5
    });
  });

  describe('window sliding', () => {
    it('should allow new requests after window passes', () => {
      vi.useFakeTimers();
      const shortConfig: RateLimitConfig = { maxRequests: 2, windowMs: 100 };

      limiter.consume('key1', shortConfig);
      limiter.consume('key1', shortConfig);
      expect(limiter.check('key1', shortConfig)).toBe(false);

      vi.advanceTimersByTime(50);
      expect(limiter.check('key1', shortConfig)).toBe(false); // still in window

      vi.advanceTimersByTime(51);
      expect(limiter.check('key1', shortConfig)).toBe(true); // window expired
    });
  });

  describe('concurrency', () => {
    it('should correctly handle 20 concurrent consumes for same key', async () => {
      const config: RateLimitConfig = { maxRequests: 10, windowMs: 60000 };

      await Promise.all(
        Array.from({ length: 20 }, () =>
          Promise.resolve(limiter.consume('concurrent-key', config))
        )
      );

      // consume() always increments; after 20 concurrent calls count is 20 > maxRequests=10
      expect(limiter.check('concurrent-key', config)).toBe(false);
    });

    it('should not interfere across different keys under concurrent access', async () => {
      const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };
      const keys = ['key-a', 'key-b', 'key-c', 'key-d'];

      // Concurrent consumes on 4 different keys, 3 per key = 12 total
      await Promise.all(
        keys.flatMap((key) =>
          Array.from({ length: 3 }, () => Promise.resolve(limiter.consume(key, config)))
        )
      );

      // Each key should have exactly 3 consumes (all under limit of 5)
      for (const key of keys) {
        expect(limiter.check(key, config)).toBe(true);
      }

      // Verify independence: saturate key-a
      limiter.consume('key-a', config);
      limiter.consume('key-a', config);
      expect(limiter.check('key-a', config)).toBe(false);

      // Other keys unaffected
      expect(limiter.check('key-b', config)).toBe(true);
      expect(limiter.check('key-c', config)).toBe(true);
    });

    it('should handle check-then-consume pattern under concurrency', async () => {
      const strictConfig: RateLimitConfig = { maxRequests: 3, windowMs: 60000 };

      // Simulate 10 concurrent check-then-consume attempts
      const results = await Promise.all(
        Array.from({ length: 10 }, () => {
          const allowed = limiter.check('cta-key', strictConfig);
          if (allowed) {
            limiter.consume('cta-key', strictConfig);
          }
          return Promise.resolve(allowed);
        })
      );

      // In JS single-threaded execution, the first 3 checks see count < 3 and consume.
      // The remaining 7 see count >= 3 and skip consume.
      const allowedCount = results.filter((r) => r === true).length;
      expect(allowedCount).toBe(3);
      expect(limiter.check('cta-key', strictConfig)).toBe(false);
    });

    it('should handle concurrent reset and consume without corruption', async () => {
      const config: RateLimitConfig = { maxRequests: 5, windowMs: 60000 };

      // Pre-fill with 2 consumes
      limiter.consume('reset-key', config);
      limiter.consume('reset-key', config);

      // Concurrent: reset + more consumes
      await Promise.all([
        Promise.resolve(limiter.reset('reset-key')),
        Promise.resolve(limiter.consume('reset-key', config)),
        Promise.resolve(limiter.consume('reset-key', config)),
        Promise.resolve(limiter.consume('reset-key', config)),
      ]);

      // Verify system is consistent — either reset deleted entry and consumes rebuilt it,
      // or consumes ran before reset and were cleared. In either case no crash.
      const entry = (limiter as any).entries.get('reset-key');
      if (entry) {
        expect(entry.count).toBeGreaterThanOrEqual(1);
        expect(entry.count).toBeLessThanOrEqual(5);
      }
      // If entry doesn't exist, reset won the race — also valid.
    });

    it('should respect window expiry under concurrent time advancement', async () => {
      vi.useFakeTimers();
      const shortConfig: RateLimitConfig = { maxRequests: 5, windowMs: 100 };

      // Concurrent consumes — count reaches 10
      await Promise.all(
        Array.from({ length: 10 }, () =>
          Promise.resolve(limiter.consume('expire-key', shortConfig))
        )
      );

      expect(limiter.check('expire-key', shortConfig)).toBe(false);

      // Advance past window — cleanup fires on next check
      vi.advanceTimersByTime(101);
      expect(limiter.check('expire-key', shortConfig)).toBe(true);

      vi.useRealTimers();
    });
  });
});
