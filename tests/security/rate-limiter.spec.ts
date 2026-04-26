/**
 * InMemoryRateLimiter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryRateLimiter } from '../../src/security/rate-limit/rate-limiter.js';
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
});
