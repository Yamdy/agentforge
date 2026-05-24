import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRateLimitProcessor,
  type RateLimitConfig,
} from '../src/harness/rate-limit-processor.js';
import type { PipelineContext } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

function makeContext(model?: string, overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: {
      config: { model: model ?? 'gpt-4' },
      promptFragments: [],
      toolDeclarations: [],
    },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 'session-1', custom: {} },
    ...overrides,
  };
}

async function executeProcessor(processor: { execute: (ctx: unknown) => Promise<unknown> }, ctx: PipelineContext): Promise<{ aborted: boolean; reason?: string; ctx?: PipelineContext }> {
  const pCtx = new ProcessorContextImpl(ctx);
  try {
    await processor.execute(pCtx);
    return { aborted: false, ctx: pCtx.state };
  } catch (e) {
    if (e instanceof AbortControlFlow) {
      return { aborted: true, reason: e.reason };
    }
    throw e;
  }
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
        const result = await executeProcessor(processor, ctx);
        // Should NOT be an abort
        expect(result.aborted).toBe(false);
      }
    });

    it('blocks requests that exceed the rate limit', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 2,
        windowMs: 60_000,
        strategy: 'block',
      });

      // First two should pass
      await executeProcessor(processor, makeContext());
      await executeProcessor(processor, makeContext());

      // Third should be blocked
      const result = await executeProcessor(processor, makeContext());
      expect(result.aborted).toBe(true);
      expect(result.reason).toContain('Rate limit exceeded');
    });

    it('resets the window after the time period passes', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 2,
        windowMs: 60_000,
        strategy: 'block',
      });

      await executeProcessor(processor, makeContext());
      await executeProcessor(processor, makeContext());

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      const result = await executeProcessor(processor, makeContext());
      expect(result.aborted).toBe(false);
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

      const result1 = await executeProcessor(processor, ctx1);
      expect(result1.aborted).toBe(false);

      const result2 = await executeProcessor(processor, ctx2);
      expect(result2.aborted).toBe(false);

      // Third call to gpt-4 should be blocked
      const ctx3 = makeContext('gpt-4');
      const result3 = await executeProcessor(processor, ctx3);
      expect(result3.aborted).toBe(true);
      expect(result3.reason).toContain('Rate limit exceeded');
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
      const result1 = await executeProcessor(processor, ctx1);
      expect(result1.aborted).toBe(false);

      // Second request should be queued (returns context with delay metadata)
      const ctx2 = makeContext();
      const result2 = await executeProcessor(processor, ctx2);
      // Queue strategy should pass through but mark the wait time
      expect(result2.ctx?.session?.custom?.rateLimitQueued).toBeDefined();
    });

    it('eventually allows queued requests after window expires', async () => {
      const processor = createRateLimitProcessor({
        maxRequests: 1,
        windowMs: 10_000,
        strategy: 'queue',
      });

      await executeProcessor(processor, makeContext());
      await executeProcessor(processor, makeContext());

      vi.advanceTimersByTime(11_000);

      const result = await executeProcessor(processor, makeContext());
      expect(result.aborted).toBe(false);
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

      // Make 3 requests at time 0, 3s, 6s
      await executeProcessor(processor, makeContext());
      vi.advanceTimersByTime(3_000);
      await executeProcessor(processor, makeContext());
      vi.advanceTimersByTime(3_000);
      await executeProcessor(processor, makeContext());

      // At time 6s, all 3 are within the 10s window.
      // 4th should be blocked
      const result = await executeProcessor(processor, makeContext());
      expect(result.aborted).toBe(true);
      expect(result.reason).toContain('Rate limit exceeded');

      // Advance past the first request's window (time 0 + 10001ms)
      vi.advanceTimersByTime(4_001); // now at time 10001ms

      // The first request (timestamp 0) now falls outside the window.
      // Only 2 requests remain in the window -> 3rd one should pass
      const result2 = await executeProcessor(processor, makeContext());
      expect(result2.aborted).toBe(false);
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
