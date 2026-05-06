/**
 * Unit tests for pricing-data.ts — model pricing lookup and cost calculation.
 *
 * Tests: getModelPricing, calculateCost, calculateCacheSavings.
 * Pure functions with no dependencies — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
  getModelPricing,
  calculateCost,
  calculateCacheSavings,
} from '../../src/observability/pricing/pricing-data.js';

// ============================================================
// getModelPricing
// ============================================================

describe('getModelPricing', () => {
  it('returns pricing for a known model', () => {
    const pricing = getModelPricing('openai', 'gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing!.inputPrice).toBeGreaterThan(0);
    expect(pricing!.outputPrice).toBeGreaterThan(0);
  });

  it('returns correct pricing values for gpt-4o', () => {
    const pricing = getModelPricing('openai', 'gpt-4o');
    expect(pricing).toEqual({
      inputPrice: 2.5,
      outputPrice: 10,
      cacheReadPrice: 1.25,
    });
  });

  it('returns pricing with cache prices for Anthropic models', () => {
    const pricing = getModelPricing('anthropic', 'claude-sonnet-4-20250514');
    expect(pricing).toBeDefined();
    expect(pricing!.cacheReadPrice).toBeGreaterThan(0);
    expect(pricing!.cacheWritePrice).toBeGreaterThan(0);
  });

  it('returns undefined for unknown provider', () => {
    expect(getModelPricing('unknown-vendor', 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined for unknown model on known provider', () => {
    expect(getModelPricing('openai', 'nonexistent-model-v99')).toBeUndefined();
  });

  it('is case-sensitive for provider name', () => {
    expect(getModelPricing('OpenAI', 'gpt-4o')).toBeUndefined();
  });

  it('handles empty string provider', () => {
    expect(getModelPricing('', 'gpt-4o')).toBeUndefined();
  });

  it('returns pricing for DeepSeek models', () => {
    const pricing = getModelPricing('deepseek', 'deepseek-chat');
    expect(pricing).toBeDefined();
    expect(pricing!.inputPrice).toBeGreaterThan(0);
  });
});

// ============================================================
// calculateCost
// ============================================================

describe('calculateCost', () => {
  it('calculates cost for prompt and completion tokens', () => {
    const cost = calculateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
    // 1M prompt at $2.5 + 1M completion at $10 = $12.50
    expect(cost).toBeCloseTo(12.5, 1);
  });

  it('calculates cost for prompt tokens only', () => {
    const cost = calculateCost('openai', 'gpt-4o', 1_000_000, 0);
    expect(cost).toBeCloseTo(2.5, 1);
  });

  it('calculates cost with cache read tokens when pricing supports it', () => {
    // claude-sonnet-4-20250514: input=3, output=15, cacheRead=0.75, cacheWrite=1.5
    const cost = calculateCost('anthropic', 'claude-sonnet-4-20250514', 1_000_000, 1_000_000, 500_000);
    // 1M*3 + 1M*15 + 500K*0.75 = $3 + $15 + $0.375 = $18.375
    expect(cost).toBeCloseTo(18.375, 1);
  });

  it('excludes cache read tokens when pricing does not support it', () => {
    // gpt-3.5-turbo has no cacheReadPrice — cache tokens should not affect cost
    const costWithCache = calculateCost('openai', 'gpt-3.5-turbo', 1000, 1000, 500);
    const costWithoutCache = calculateCost('openai', 'gpt-3.5-turbo', 1000, 1000, 0);
    expect(costWithCache).toBe(costWithoutCache);
  });

  it('returns 0 for unknown model', () => {
    const cost = calculateCost('unknown', 'unknown-model', 1_000_000, 1_000_000);
    expect(cost).toBe(0);
  });

  it('returns 0 for zero tokens', () => {
    const cost = calculateCost('openai', 'gpt-4o', 0, 0);
    expect(cost).toBe(0);
  });

  it('handles large token counts without overflow', () => {
    const cost = calculateCost('openai', 'gpt-4o', 1_000_000_000, 1_000_000_000);
    expect(Number.isFinite(cost)).toBe(true);
    expect(Number.isNaN(cost)).toBe(false);
  });
});

// ============================================================
// calculateCacheSavings
// ============================================================

describe('calculateCacheSavings', () => {
  it('returns savings for a model with cache read pricing', () => {
    const savings = calculateCacheSavings('anthropic', 'claude-sonnet-4-20250514', 1_000_000);
    // 1M cache read tokens * (15 - 0.30) = 1M * 14.70 / 1M = $14.70
    expect(savings).toBeGreaterThan(0);
  });

  it('returns 0 for a model without cache read pricing', () => {
    // gpt-3.5-turbo has no cacheReadPrice
    const savings = calculateCacheSavings('openai', 'gpt-3.5-turbo', 1_000_000);
    expect(savings).toBe(0);
  });

  it('returns 0 for unknown model', () => {
    const savings = calculateCacheSavings('unknown', 'unknown-model', 1_000_000);
    expect(savings).toBe(0);
  });

  it('returns 0 for zero cache read tokens', () => {
    const savings = calculateCacheSavings('anthropic', 'claude-sonnet-4-20250514', 0);
    expect(savings).toBe(0);
  });
});
