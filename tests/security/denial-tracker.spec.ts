/**
 * DenialTracker Tests
 *
 * TDD: Tests written before implementation.
 * Tests will FAIL initially — DenialTracker class does not exist yet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DenialTracker } from '../../src/security/permission/denial-tracker.js';

describe('DenialTracker', () => {
  let tracker: DenialTracker;
  let now: number;

  beforeEach(() => {
    now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    tracker = new DenialTracker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('recordDenial()', () => {
    it('records single denial', () => {
      tracker.recordDenial('tool:write');

      expect(tracker.getDenialCount('tool:write')).toBe(1);
    });

    it('records multiple denials for same tool', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.getDenialCount('tool:write')).toBe(3);
    });

    it('tracks different tools independently', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:read');

      expect(tracker.getDenialCount('tool:write')).toBe(2);
      expect(tracker.getDenialCount('tool:read')).toBe(1);
      expect(tracker.getDenialCount('tool:unknown')).toBe(0);
    });

    it('returns 0 for never-denied tools', () => {
      expect(tracker.getDenialCount('tool:read')).toBe(0);
    });
  });

  describe('shouldAutoDeny()', () => {
    it('returns false when below threshold', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.shouldAutoDeny('tool:write')).toBe(false);
    });

    it('returns true when at threshold (default maxDenialsBeforeDowngrade=3)', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.shouldAutoDeny('tool:write')).toBe(true);
    });

    it('returns true when above threshold', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.getDenialCount('tool:write')).toBe(4);
      expect(tracker.shouldAutoDeny('tool:write')).toBe(true);
    });

    it('returns false for unknown tools', () => {
      expect(tracker.shouldAutoDeny('tool:unknown')).toBe(false);
    });

    it('respects custom maxDenialsBeforeDowngrade config', () => {
      const custom = new DenialTracker({ maxDenialsBeforeDowngrade: 5 });

      custom.recordDenial('tool:write');
      custom.recordDenial('tool:write');
      custom.recordDenial('tool:write');
      custom.recordDenial('tool:write');

      expect(custom.shouldAutoDeny('tool:write')).toBe(false);

      custom.recordDenial('tool:write');
      expect(custom.shouldAutoDeny('tool:write')).toBe(true);
    });
  });

  describe('shouldDowngradeMode()', () => {
    it('returns false when all tools below threshold', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:read');

      expect(tracker.shouldDowngradeMode()).toBe(false);
    });

    it('returns true when any tool exceeds threshold', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.shouldAutoDeny('tool:write')).toBe(true);
      expect(tracker.shouldDowngradeMode()).toBe(true);
    });

    it('returns false when tracker is empty', () => {
      expect(tracker.shouldDowngradeMode()).toBe(false);
    });
  });

  describe('getDeniedTools()', () => {
    it('returns empty array when no denials tracked', () => {
      expect(tracker.getDeniedTools()).toEqual([]);
    });

    it('returns all tool names with at least one denial', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:read');

      const tools = tracker.getDeniedTools();
      expect(tools).toHaveLength(2);
      expect(tools).toContain('tool:write');
      expect(tools).toContain('tool:read');
    });
  });

  describe('reset()', () => {
    it('clears single tool tracking', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.shouldAutoDeny('tool:write')).toBe(true);

      tracker.reset('tool:write');

      expect(tracker.getDenialCount('tool:write')).toBe(0);
      expect(tracker.shouldAutoDeny('tool:write')).toBe(false);
    });

    it('does not affect other tools', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:read');

      tracker.reset('tool:write');

      expect(tracker.getDenialCount('tool:write')).toBe(0);
      expect(tracker.getDenialCount('tool:read')).toBe(1);
    });

    it('does not throw for non-existent tool', () => {
      expect(() => tracker.reset('tool:nonexistent')).not.toThrow();
    });
  });

  describe('resetAll()', () => {
    it('clears all tracking', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:read');
      tracker.recordDenial('tool:exec');

      tracker.resetAll();

      expect(tracker.getDeniedTools()).toEqual([]);
      expect(tracker.getDenialCount('tool:write')).toBe(0);
      expect(tracker.getDenialCount('tool:read')).toBe(0);
      expect(tracker.shouldDowngradeMode()).toBe(false);
    });

    it('does not throw when already empty', () => {
      expect(() => tracker.resetAll()).not.toThrow();
    });
  });

  describe('getSummary()', () => {
    it('returns empty array when no denials', () => {
      expect(tracker.getSummary()).toEqual([]);
    });

    it('returns correct structure for tracked tools', () => {
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write'); // auto-denied (>=3)
      tracker.recordDenial('tool:read'); // not auto-denied (<3)

      const summary = tracker.getSummary();

      expect(summary).toHaveLength(2);

      const writeEntry = summary.find(s => s.tool === 'tool:write');
      const readEntry = summary.find(s => s.tool === 'tool:read');

      expect(writeEntry).toEqual({ tool: 'tool:write', count: 3, autoDenied: true });
      expect(readEntry).toEqual({ tool: 'tool:read', count: 1, autoDenied: false });
    });
  });

  describe('config', () => {
    it('uses default config values', () => {
      // maxDenialsBeforeDowngrade defaults to 3
      tracker.recordDenial('tool:write');
      tracker.recordDenial('tool:write');

      expect(tracker.shouldAutoDeny('tool:write')).toBe(false);

      tracker.recordDenial('tool:write');
      expect(tracker.shouldAutoDeny('tool:write')).toBe(true);
    });

    it('stores exact config values via Partial config', () => {
      const custom = new DenialTracker({
        maxDenialsBeforeDowngrade: 10,
        downgradeAction: 'ask',
        resetAfterMs: 60000,
      });

      custom.recordDenial('tool:write');
      // After 1 denial, should NOT auto-deny (need 10)
      expect(custom.shouldAutoDeny('tool:write')).toBe(false);

      // Record 9 more
      for (let i = 0; i < 9; i++) {
        custom.recordDenial('tool:write');
      }

      expect(custom.shouldAutoDeny('tool:write')).toBe(true);
    });
  });

  describe('auto-reset after time elapsed', () => {
    it('resets tool counter after resetAfterMs has passed since last denial', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');

      expect(shortReset.shouldAutoDeny('tool:write')).toBe(true);

      // Advance time past resetAfterMs
      vi.advanceTimersByTime(1001);

      // Counter should have been auto-reset
      expect(shortReset.getDenialCount('tool:write')).toBe(0);
      expect(shortReset.shouldAutoDeny('tool:write')).toBe(false);
    });

    it('does not reset if within resetAfterMs window', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');

      vi.advanceTimersByTime(500);

      // Still within window
      expect(shortReset.shouldAutoDeny('tool:write')).toBe(true);
      expect(shortReset.getDenialCount('tool:write')).toBe(3);
    });

    it('resets per-tool independently based on last denial', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 500 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');

      vi.advanceTimersByTime(100);

      shortReset.recordDenial('tool:read');

      vi.advanceTimersByTime(450);

      // tool:write last denied 550ms ago → reset
      // tool:read last denied 450ms ago → still active
      expect(shortReset.getDenialCount('tool:write')).toBe(0);
      expect(shortReset.getDenialCount('tool:read')).toBe(1);
    });

    it('shouldDowngradeMode respects auto-reset', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');

      expect(shortReset.shouldDowngradeMode()).toBe(true);

      vi.advanceTimersByTime(1001);

      expect(shortReset.shouldDowngradeMode()).toBe(false);
    });

    it('getSummary excludes auto-reset tools', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:read');

      vi.advanceTimersByTime(1001);

      const summary = shortReset.getSummary();
      expect(summary).toHaveLength(0);
    });
  });

  describe('purgeExpired()', () => {
    it('removes expired entries but keeps active ones', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write'); // expires after 1000ms

      vi.advanceTimersByTime(1001);

      // tool:write should now be expired
      // Record tool:read AFTER time advance so it's still active
      shortReset.recordDenial('tool:read');
      shortReset.recordDenial('tool:read');

      shortReset.purgeExpired();

      // tool:write should be deleted, tool:read should remain
      expect(shortReset.getDenialCount('tool:write')).toBe(0);
      expect(shortReset.getDenialCount('tool:read')).toBe(2);
    });

    it('does not remove entries within resetAfterMs window', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');

      vi.advanceTimersByTime(500);

      shortReset.purgeExpired();

      expect(shortReset.getDenialCount('tool:write')).toBe(3);
      expect(shortReset.shouldAutoDeny('tool:write')).toBe(true);
    });

    it('clears all entries when all expired', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:read');

      vi.advanceTimersByTime(1001);

      shortReset.purgeExpired();

      expect(shortReset.getDeniedTools()).toEqual([]);
    });

    it('does not throw when tracker is empty', () => {
      expect(() => tracker.purgeExpired()).not.toThrow();
    });

    it('query methods remain pure and do not delete entries', () => {
      const shortReset = new DenialTracker({ resetAfterMs: 1000 });

      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');
      shortReset.recordDenial('tool:write');

      vi.advanceTimersByTime(1001);

      // Query methods should report 0 for expired tools
      expect(shortReset.getDenialCount('tool:write')).toBe(0);
      expect(shortReset.shouldAutoDeny('tool:write')).toBe(false);
      expect(shortReset.shouldDowngradeMode()).toBe(false);

      // But entry still exists in map (not deleted by query methods)
      // Record another denial to verify entry still exists and can be reused
      shortReset.recordDenial('tool:write');
      expect(shortReset.getDenialCount('tool:write')).toBe(1);

      // After purge, the entry should still be there since it was just updated
      shortReset.purgeExpired();
      expect(shortReset.getDenialCount('tool:write')).toBe(1);
    });
  });
});
