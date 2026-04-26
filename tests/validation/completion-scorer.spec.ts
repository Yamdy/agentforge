/**
 * Unit tests for src/validation/completion-scorer.ts
 *
 * Tests CompletionScorer with plan step status tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CompletionScorerImpl } from '../../src/validation/completion-scorer.js';
import type { CompletionScorer } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// CompletionScorer Tests
// ============================================================

describe('CompletionScorer', () => {
  let scorer: CompletionScorer;

  beforeEach(() => {
    scorer = new CompletionScorerImpl();
  });

  // --------------------------------------------------------
  // Basic Scoring
  // --------------------------------------------------------

  describe('basic scoring', () => {
    it('should return 100% when all steps are completed', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'completed' },
          { status: 'completed' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(100);
      expect(result.completedSteps).toBe(3);
      expect(result.totalSteps).toBe(3);
    });

    it('should return 0% when no steps are completed', () => {
      const plan = {
        steps: [
          { status: 'pending' },
          { status: 'pending' },
          { status: 'pending' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(0);
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(3);
    });

    it('should return 50% when half steps are completed', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'pending' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(50);
      expect(result.completedSteps).toBe(1);
      expect(result.totalSteps).toBe(2);
    });

    it('should calculate correct percentage for partial completion', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'completed' },
          { status: 'pending' },
          { status: 'pending' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(50);
      expect(result.completedSteps).toBe(2);
      expect(result.totalSteps).toBe(4);
    });
  });

  // --------------------------------------------------------
  // Empty Plan
  // --------------------------------------------------------

  describe('empty plan', () => {
    it('should return 100% for empty plan (no steps)', () => {
      const plan = { steps: [] };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(100);
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(0);
    });
  });

  // --------------------------------------------------------
  // Single Step
  // --------------------------------------------------------

  describe('single step', () => {
    it('should return 100% for single completed step', () => {
      const plan = { steps: [{ status: 'completed' }] };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(100);
      expect(result.completedSteps).toBe(1);
      expect(result.totalSteps).toBe(1);
    });

    it('should return 0% for single pending step', () => {
      const plan = { steps: [{ status: 'pending' }] };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(0);
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(1);
    });
  });

  // --------------------------------------------------------
  // Various Status Values
  // --------------------------------------------------------

  describe('various status values', () => {
    it('should count only "completed" steps as done', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'running' },
          { status: 'pending' },
          { status: 'failed' },
          { status: 'skipped' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.completedSteps).toBe(1);
      expect(result.totalSteps).toBe(5);
      expect(result.percentage).toBe(20);
    });

    it('should handle "done" as equivalent to completed', () => {
      const plan = {
        steps: [
          { status: 'done' },
          { status: 'done' },
          { status: 'pending' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.completedSteps).toBe(2);
      expect(result.totalSteps).toBe(3);
    });

    it('should handle mixed statuses', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'running' },
          { status: 'failed' },
          { status: 'cancelled' },
          { status: 'pending' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.completedSteps).toBe(1);
      expect(result.totalSteps).toBe(5);
      expect(result.percentage).toBe(20);
    });
  });

  // --------------------------------------------------------
  // Details
  // --------------------------------------------------------

  describe('details', () => {
    it('should include details array in result', () => {
      const plan = { steps: [{ status: 'completed' }] };
      const result = scorer.score(plan);
      expect(result.details).toBeDefined();
      expect(Array.isArray(result.details)).toBe(true);
    });

    it('should include step status summary in details', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'completed' },
          { status: 'pending' },
          { status: 'running' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.details.length).toBeGreaterThan(0);
    });

    it('should have empty details for empty plan', () => {
      const plan = { steps: [] };
      const result = scorer.score(plan);
      expect(result.details).toEqual([]);
    });
  });

  // --------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------

  describe('edge cases', () => {
    it('should handle large number of steps', () => {
      const steps = Array.from({ length: 1000 }, (_, i) => ({
        status: i < 750 ? 'completed' : 'pending',
      }));
      const plan = { steps };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(75);
      expect(result.completedSteps).toBe(750);
      expect(result.totalSteps).toBe(1000);
    });

    it('should handle all failed steps', () => {
      const plan = {
        steps: [
          { status: 'failed' },
          { status: 'failed' },
          { status: 'failed' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(0);
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(3);
    });

    it('should handle all running steps', () => {
      const plan = {
        steps: [
          { status: 'running' },
          { status: 'running' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.percentage).toBe(0);
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(2);
    });

    it('should handle unknown status values', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'unknown-status' },
          { status: '' },
        ],
      };
      const result = scorer.score(plan);
      expect(result.completedSteps).toBe(1);
      expect(result.totalSteps).toBe(3);
    });

    it('should round percentage to nearest integer', () => {
      const plan = {
        steps: [
          { status: 'completed' },
          { status: 'pending' },
          { status: 'pending' },
        ],
      };
      const result = scorer.score(plan);
      // 1/3 = 33.33... → should be rounded
      expect(result.percentage).toBeCloseTo(33.33, 0);
      expect(Number.isInteger(result.percentage)).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Score Structure
  // --------------------------------------------------------

  describe('score structure', () => {
    it('should return all required fields', () => {
      const plan = { steps: [{ status: 'completed' }] };
      const result = scorer.score(plan);
      expect(result).toHaveProperty('percentage');
      expect(result).toHaveProperty('completedSteps');
      expect(result).toHaveProperty('totalSteps');
      expect(result).toHaveProperty('details');
    });

    it('should have percentage as number', () => {
      const plan = { steps: [{ status: 'completed' }] };
      const result = scorer.score(plan);
      expect(typeof result.percentage).toBe('number');
    });

    it('should have completedSteps as integer', () => {
      const plan = { steps: [{ status: 'completed' }] };
      const result = scorer.score(plan);
      expect(Number.isInteger(result.completedSteps)).toBe(true);
    });

    it('should have totalSteps as integer', () => {
      const plan = { steps: [{ status: 'completed' }] };
      const result = scorer.score(plan);
      expect(Number.isInteger(result.totalSteps)).toBe(true);
    });
  });
});
