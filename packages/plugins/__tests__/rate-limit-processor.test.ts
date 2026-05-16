import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRateLimitProcessor,
  type RateLimitConfig,
} from '../src/harness/rate-limit-processor.js';
import type { PipelineContext } from '@agentforge/sdk';

function makeContext(model?: string, overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: {
      config: { model: model ?? 'gpt-4' },
      promptFragments: [],
      toolDeclarations: [],
    },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

describe('createRateLimitProcessor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Basic rate limiting — block strategy
  // ---------------------------------------------------------------------------
  describe('block strategy', () => {
    it('allows requests within the rate limit', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 5,
        windowMs: 60_000,
        strategy: 'block',
      });

      for (let i = 0; i < 5; i++) {
        const ctx = makeContext();
        const result = await processor.execute(ctx);
        // Should NOT be an abort
        expect(result).toEqual(ctx);
      }
    });

    it('blocks requests that exceed the rate limit', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 2,
        windowMs: 60_000,
        strategy: 'block',
      });

      // First two should pass
      await processor.execute(makeContext());
      await processor.execute(makeContext());

      // Third should be blocked
      const result = await processor.execute(makeContext());
      expect(result).toEqual({
        type: 'abort',
        reason: expect.stringContaining('Rate limit exceeded'),
      });
    });

    it('resets the window after the time period passes', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 2,
        windowMs: 60_000,
        strategy: 'block',
      });

      await processor.execute(makeContext());
      await processor.execute(makeContext());

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      const result = await processor.execute(makeContext());
      expect(result).toEqual(makeContext());
    });
  });

  // ---------------------------------------------------------------------------
  // Per-model rate limiting
  // ---------------------------------------------------------------------------
  describe('per-model rate limiting', () => {
    it('applies limits independently per model', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 1,
        windowMs: 60_000,
        strategy: 'block',
        perModel: true,
      });

      const ctx1 = makeContext('gpt-4');
      const ctx2 = makeContext('claude-3');

      const result1 = await processor.execute(ctx1);
      expect(result1).toEqual(ctx1);

      const result2 = await processor.execute(ctx2);
      expect(result2).toEqual(ctx2);

      // Third call to gpt-4 should be blocked
      const ctx3 = makeContext('gpt-4');
      const result3 = await processor.execute(ctx3);
      expect(result3).toEqual({
        type: 'abort',
        reason: expect.stringContaining('Rate limit exceeded'),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Queue strategy
  // ---------------------------------------------------------------------------
  describe('queue strategy', () => {
    it('queues requests that exceed the limit and processes after delay', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 1,
        windowMs: 10_000,
        strategy: 'queue',
      });

      // First request passes immediately
      const ctx1 = makeContext();
      const result1 = await processor.execute(ctx1);
      expect(result1).toEqual(ctx1);

      // Second request should be queued (returns context with delay metadata)
      const ctx2 = makeContext();
      const result2 = await processor.execute(ctx2) as PipelineContext;
      // Queue strategy should pass through but mark the wait time
      expect((result2 as PipelineContext).session?.custom?.rateLimitQueued).toBeDefined();
    });

    it('eventually allows queued requests after window expires', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 1,
        windowMs: 10_000,
        strategy: 'queue',
      });

      await processor.execute(makeContext());
      await processor.execute(makeContext());

      vi.advanceTimersByTime(11_000);

      const result = await processor.execute(makeContext());
      expect(result).toEqual(makeContext());
    });
  });

  // ---------------------------------------------------------------------------
  // Sliding window accuracy
  // ---------------------------------------------------------------------------
  describe('sliding window', () => {
    it('uses a sliding window (old requests expire individually)', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 3,
        windowMs: 10_000,
        strategy: 'block',
      });

      // Make 3 requests at time 0
      await processor.execute(makeContext());
      vi.advanceTimersByTime(3_000);
      await processor.execute(makeContext());
      vi.advanceTimersByTime(3_000);
      await processor.execute(makeContext());

      // At time 6s, the window covers [0, 10000]. All 3 are within.
      // 4th should be blocked
      const result = await processor.execute(makeContext());
      expect(result).toEqual({
        type: 'abort',
        reason: expect.stringContaining('Rate limit exceeded'),
      });

      // At time 10s, the first request (at time 0) expires
      vi.advanceTimersByTime(4_000); // now at time 10s

      // The window now covers [0, 20000] but the request at time 0
      // is older than windowMs from now, so it's expired.
      // Only 2 requests remain in the window -> 3rd one should pass
      const result2 = await processor.execute(makeContext());
      expect(result2).toEqual(makeContext());
    });
  });

  // ---------------------------------------------------------------------------
  // Plugin registration
  // ---------------------------------------------------------------------------
  describe('plugin registration', () => {
    it('returns a processor with stage gateLLM', () => {
      const processor = createRateLimitProcessor({
        maxRequests: 10,
        windowMs: 60_000,
        strategy: 'block',
      });
      expect(processor.stage).toBe('gateLLM');
    });
  });
});
