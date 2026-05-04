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

  // ----------------------------------------------------------
  // Multiple sessions + limits
  // ----------------------------------------------------------

  describe('multiple sessions', () => {
    it('should track sessions independently', async () => {
      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 100, completionTokens: 50 }));
      await tracker.record('session-2', 'gpt-4o', createUsage({ promptTokens: 500, completionTokens: 200 }));

      const usage1 = await tracker.getUsage('session-1');
      const usage2 = await tracker.getUsage('session-2');

      expect(usage1.totalCost).toBeGreaterThan(0);
      expect(usage2.totalCost).toBeGreaterThan(0);
      expect(usage1.totalCost).not.toBe(usage2.totalCost);
      expect(usage1.byModel['gpt-4o']!.tokens.promptTokens).toBe(100);
      expect(usage2.byModel['gpt-4o']!.tokens.promptTokens).toBe(500);
    });

    it('should independently enforce limits per session', async () => {
      await tracker.setLimit('session-1', { maxTokens: 100 });
      await tracker.setLimit('session-2', { maxTokens: 1000 });

      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 200, completionTokens: 0 }));
      await tracker.record('session-2', 'gpt-4o', createUsage({ promptTokens: 200, completionTokens: 0 }));

      const check1 = await tracker.checkLimit('session-1');
      const check2 = await tracker.checkLimit('session-2');

      expect(check1.withinLimit).toBe(false);
      expect(check2.withinLimit).toBe(true);
    });
  });

  describe('cost limit only', () => {
    it('should detect when cost exceeds limit', async () => {
      // Use large tokens to trigger high cost
      await tracker.setLimit('session-1', { maxCost: 0.001 });
      await tracker.record('session-1', 'gpt-4o', createUsage({ promptTokens: 50000, completionTokens: 50000 }));

      const result = await tracker.checkLimit('session-1');
      expect(result.withinLimit).toBe(false);
      expect(result.exceeded!.some((e) => e.includes('cost'))).toBe(true);
    });

    it('should detect when requests exceed limit', async () => {
      await tracker.setLimit('session-1', { maxRequests: 2 });
      await tracker.record('session-1', 'gpt-4o', createUsage());
      await tracker.record('session-1', 'gpt-4o', createUsage());
      await tracker.record('session-1', 'gpt-4o', createUsage());

      const result = await tracker.checkLimit('session-1');
      expect(result.withinLimit).toBe(false);
      expect(result.exceeded!.some((e) => e.includes('requests'))).toBe(true);
    });
  });

  describe('time range', () => {
    it('should set startTime and endTime on usage', async () => {
      await tracker.record('session-1', 'gpt-4o', createUsage());
      const usage = await tracker.getUsage('session-1');

      expect(usage.timeRange).toBeDefined();
      expect(usage.timeRange.start).toBeTruthy();
      expect(usage.timeRange.end).toBeTruthy();
      // ISO 8601 format
      expect(usage.timeRange.start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('concurrency', () => {
    it('should sum costs correctly under concurrent record calls to same session', async () => {
      const usages = Array.from({ length: 20 }, () =>
        createUsage({ promptTokens: 100, completionTokens: 50 })
      );

      await Promise.all(
        usages.map((usage) => tracker.record('concurrent-session', 'gpt-4o', usage))
      );

      const result = await tracker.getUsage('concurrent-session');
      expect(result.byModel['gpt-4o']).toBeDefined();
      expect(result.byModel['gpt-4o']!.requests).toBe(20);
      expect(result.byModel['gpt-4o']!.tokens.promptTokens).toBe(20 * 100);
      expect(result.byModel['gpt-4o']!.tokens.completionTokens).toBe(20 * 50);
      expect(result.totalCost).toBeGreaterThan(0);
    });

    it('should handle concurrent record across different sessions without interference', async () => {
      const sessions = ['s1', 's2', 's3', 's4', 's5'];

      // 5 sessions x 4 concurrent records each = 20 total
      await Promise.all(
        sessions.flatMap((sid) =>
          Array.from({ length: 4 }, () =>
            tracker.record(sid, 'gpt-4o', createUsage({ promptTokens: 100, completionTokens: 50 }))
          )
        )
      );

      // Each session should have exactly 4 requests
      for (const sid of sessions) {
        const usage = await tracker.getUsage(sid);
        expect(usage.byModel['gpt-4o']).toBeDefined();
        expect(usage.byModel['gpt-4o']!.requests).toBe(4);
        expect(usage.byModel['gpt-4o']!.tokens.promptTokens).toBe(400);
      }
    });

    it('should return consistent snapshot when getUsage called concurrently with record', async () => {
      // Seed initial record
      await tracker.record('rw-session', 'gpt-4o', createUsage({ promptTokens: 100, completionTokens: 50 }));

      // Concurrent: record more + read usage
      const [_, usageSnapshot] = await Promise.all([
        tracker.record('rw-session', 'gpt-4o', createUsage({ promptTokens: 200, completionTokens: 100 })),
        tracker.getUsage('rw-session'),
      ]);

      // Snapshot may include concurrent record or not — either is valid
      expect(usageSnapshot.sessionId).toBe('rw-session');
      expect(usageSnapshot.byModel['gpt-4o']).toBeDefined();
      expect([1, 2]).toContain(usageSnapshot.byModel['gpt-4o']!.requests);
      // No crash, no corruption
    });

    it('should handle concurrent record and reset without data corruption', async () => {
      await tracker.record('reset-session', 'gpt-4o', createUsage({ promptTokens: 100, completionTokens: 50 }));

      await Promise.all([
        tracker.reset('reset-session'),
        tracker.record('reset-session', 'gpt-4o', createUsage({ promptTokens: 200, completionTokens: 100 })),
      ]);

      // After concurrent reset+record, session has 1 record (from the concurrent record call)
      const usage = await tracker.getUsage('reset-session');
      expect(usage.byModel['gpt-4o']).toBeDefined();
      expect(usage.byModel['gpt-4o']!.requests).toBe(1);
    });

    it('should handle concurrent checkLimit and record without error', async () => {
      await tracker.setLimit('limit-session', { maxRequests: 5 });

      // Record 4 times + check limit concurrently
      const promises: Promise<unknown>[] = [
        ...Array.from({ length: 4 }, () =>
          tracker.record('limit-session', 'gpt-4o', createUsage({ promptTokens: 100, completionTokens: 50 }))
        ),
      ];
      const checkPromise = tracker.checkLimit('limit-session');
      promises.push(checkPromise);

      await Promise.all(promises);

      const result = await checkPromise;
      // Limit result should be well-defined regardless of interleaving
      expect(result.withinLimit).toBeDefined();
      expect(result.current).toBeDefined();
    });
  });
});
