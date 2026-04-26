/**
 * Unit tests for CostTracker
 *
 * Tests in-memory cost tracking with model-based pricing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCostTracker } from '../../src/quota/cost-tracker.js';
import type { LLMUsage } from '../../src/core/interfaces.js';

// ============================================================
// Test Helpers
// ============================================================

function createUsage(overrides?: Partial<LLMUsage>): LLMUsage {
  return {
    promptTokens: overrides?.promptTokens ?? 1000,
    completionTokens: overrides?.completionTokens ?? 500,
  };
}

// ============================================================
// CostTracker Tests
// ============================================================

describe('MemoryCostTracker', () => {
  let tracker: MemoryCostTracker;

  beforeEach(() => {
    tracker = new MemoryCostTracker();
  });

  // ----------------------------------------------------------
  // TC-010: record() should record cost
  // ----------------------------------------------------------

  describe('record', () => {
    it('TC-010: should record cost', async () => {
      await tracker.record('session-1', 'gpt-4o', createUsage());

      const usage = await tracker.getUsage('session-1');
      expect(usage.totalCost).toBeGreaterThan(0);
      expect(usage.byModel['gpt-4o']).toBeDefined();
      expect(usage.byModel['gpt-4o']!.tokens.promptTokens).toBe(1000);
      expect(usage.byModel['gpt-4o']!.tokens.completionTokens).toBe(500);
      expect(usage.byModel['gpt-4o']!.requests).toBe(1);
    });
  });

  // ----------------------------------------------------------
  // TC-011: getUsage() should return cost breakdown
  // ----------------------------------------------------------

  describe('getUsage', () => {
    it('TC-011: should return cost breakdown', async () => {
      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 1000, completionTokens: 500 }));
      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 2000, completionTokens: 1000 }));
      await tracker.record('session-1', 'claude-3-5-sonnet', createUsage({ promptTokens: 500, completionTokens: 300 }));

      const usage = await tracker.getUsage('session-1');
      expect(usage.sessionId).toBe('session-1');
      expect(usage.totalCost).toBeGreaterThan(0);

      // gpt-4o accumulated
      expect(usage.byModel['gpt-4o']!.tokens.promptTokens).toBe(3000);
      expect(usage.byModel['gpt-4o']!.tokens.completionTokens).toBe(1500);
      expect(usage.byModel['gpt-4o']!.requests).toBe(2);

      // claude separate
      expect(usage.byModel['claude-3-5-sonnet']!.tokens.promptTokens).toBe(500);
      expect(usage.byModel['claude-3-5-sonnet']!.requests).toBe(1);
    });

    it('should return zero breakdown for unknown session', async () => {
      const usage = await tracker.getUsage('unknown-session');
      expect(usage.sessionId).toBe('unknown-session');
      expect(usage.totalCost).toBe(0);
      expect(Object.keys(usage.byModel)).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------
  // TC-012: checkLimit() within limit should return true
  // ----------------------------------------------------------

  describe('checkLimit', () => {
    it('TC-012: within limit should return withinLimit=true', async () => {
      await tracker.setLimit('session-1', { maxTokens: 10000, maxCost: 1.0, maxRequests: 100 });
      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 100, completionTokens: 50 }));

      const result = await tracker.checkLimit('session-1');
      expect(result.withinLimit).toBe(true);
      expect(result.exceeded).toBeUndefined();
    });

    // ----------------------------------------------------------
    // TC-013: checkLimit() exceeding limit should return false
    // ----------------------------------------------------------

    it('TC-013: exceeding limit should return withinLimit=false', async () => {
      await tracker.setLimit('session-1', { maxTokens: 100 });
      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 200, completionTokens: 50 }));

      const result = await tracker.checkLimit('session-1');
      expect(result.withinLimit).toBe(false);
      expect(result.exceeded).toBeDefined();
      expect(result.exceeded!.length).toBeGreaterThan(0);
    });

    it('should report withinLimit=true when no limit set', async () => {
      await tracker.record('session-1', 'gpt-4o', createUsage());
      const result = await tracker.checkLimit('session-1');
      expect(result.withinLimit).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // TC-014: setLimit() should set limit
  // ----------------------------------------------------------

  describe('setLimit', () => {
    it('TC-014: should set limit', async () => {
      await tracker.setLimit('session-1', { maxTokens: 5000, maxCost: 0.5, maxRequests: 50 });

      const limit = await tracker.getLimit('session-1');
      expect(limit).not.toBeNull();
      expect(limit!.maxTokens).toBe(5000);
      expect(limit!.maxCost).toBe(0.5);
      expect(limit!.maxRequests).toBe(50);
    });

    it('should return null for session without limit', async () => {
      const limit = await tracker.getLimit('unknown');
      expect(limit).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // TC-015: reset() should reset usage
  // ----------------------------------------------------------

  describe('reset', () => {
    it('TC-015: should reset usage', async () => {
      await tracker.record('session-1', 'gpt-4o', createUsage());
      const before = await tracker.getUsage('session-1');
      expect(before.totalCost).toBeGreaterThan(0);

      await tracker.reset('session-1');
      const after = await tracker.getUsage('session-1');
      expect(after.totalCost).toBe(0);
      expect(Object.keys(after.byModel)).toHaveLength(0);
    });
  });
});
