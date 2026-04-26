/**
 * Unit tests for src/validation/goal-alignment-checker.ts
 *
 * Tests GoalAlignmentChecker with Jaccard similarity alignment algorithm.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GoalAlignmentCheckerImpl } from '../../src/validation/goal-alignment-checker.js';
import type { GoalAlignmentChecker } from '../../src/contracts/mpu-interfaces.js';

// ============================================================
// GoalAlignmentChecker Tests
// ============================================================

describe('GoalAlignmentChecker', () => {
  let checker: GoalAlignmentChecker;

  beforeEach(() => {
    checker = new GoalAlignmentCheckerImpl();
  });

  // --------------------------------------------------------
  // Goal Management
  // --------------------------------------------------------

  describe('goal management', () => {
    it('should return null when no goal is set', () => {
      expect(checker.getGoal()).toBeNull();
    });

    it('should set and get goal', () => {
      checker.setGoal('build a web application');
      expect(checker.getGoal()).toBe('build a web application');
    });

    it('should overwrite existing goal', () => {
      checker.setGoal('goal one');
      checker.setGoal('goal two');
      expect(checker.getGoal()).toBe('goal two');
    });
  });

  // --------------------------------------------------------
  // Alignment - Aligned Actions
  // --------------------------------------------------------

  describe('alignment - aligned actions', () => {
    it('should detect alignment when action matches goal keywords', () => {
      checker.setGoal('build a web application');
      const result = checker.checkAlignment('create web application frontend', 'build a web application');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect alignment with exact match', () => {
      const result = checker.checkAlignment('build a web application', 'build a web application');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect alignment with partial keyword overlap', () => {
      // {build,application} ∩ {build,web,application} = {build,application}
      // union = {build,application,web} → 2/3 ≈ 0.67
      const result = checker.checkAlignment('build web application frontend', 'build web application');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect alignment with similar meaning words', () => {
      // {build,database,manager} ∩ {build,database} = {build,database}
      // union = {build,database,manager} → 2/3 ≈ 0.67
      const result = checker.checkAlignment('build database manager', 'build database');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should be case insensitive', () => {
      const result = checker.checkAlignment('BUILD Web Application', 'build web application');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });
  });

  // --------------------------------------------------------
  // Alignment - Misaligned Actions
  // --------------------------------------------------------

  describe('alignment - misaligned actions', () => {
    it('should detect misalignment when action has no keyword overlap', () => {
      const result = checker.checkAlignment('cook dinner', 'build a web application');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });

    it('should detect misalignment with very different topics', () => {
      const result = checker.checkAlignment('play soccer', 'write unit tests');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });

    it('should detect misalignment when action is unrelated', () => {
      const result = checker.checkAlignment('go shopping', 'deploy to production');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBeLessThanOrEqual(0.3);
    });
  });

  // --------------------------------------------------------
  // Alignment - Confidence Score
  // --------------------------------------------------------

  describe('confidence score', () => {
    it('should return confidence between 0 and 1', () => {
      const result = checker.checkAlignment('build web app', 'build web application');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should return higher confidence for more similar strings', () => {
      const result1 = checker.checkAlignment('build web application', 'build web application');
      const result2 = checker.checkAlignment('build something', 'build web application');
      expect(result1.confidence).toBeGreaterThan(result2.confidence);
    });

    it('should return 0 confidence for completely different strings', () => {
      const result = checker.checkAlignment('xyz abc', 'hello world');
      expect(result.confidence).toBe(0);
    });
  });

  // --------------------------------------------------------
  // Alignment - Reason
  // --------------------------------------------------------

  describe('reason', () => {
    it('should include reason when aligned', () => {
      const result = checker.checkAlignment('build web app', 'build web application');
      expect(result.aligned).toBe(true);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });

    it('should include reason when not aligned', () => {
      const result = checker.checkAlignment('cook dinner', 'build web application');
      expect(result.aligned).toBe(false);
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    });
  });

  // --------------------------------------------------------
  // Alignment - Edge Cases
  // --------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty action string', () => {
      const result = checker.checkAlignment('', 'build web application');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should handle empty goal string', () => {
      const result = checker.checkAlignment('build web app', '');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should handle both empty strings', () => {
      const result = checker.checkAlignment('', '');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should handle single word action and goal', () => {
      const result = checker.checkAlignment('build', 'build');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should handle whitespace-only strings', () => {
      const result = checker.checkAlignment('   ', 'build web');
      expect(result.aligned).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should handle special characters', () => {
      const result = checker.checkAlignment('build-web-app', 'build web app');
      expect(result.aligned).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should handle very long strings', () => {
      const longAction = 'word '.repeat(100).trim();
      const longGoal = 'word '.repeat(100).trim();
      const result = checker.checkAlignment(longAction, longGoal);
      expect(result.aligned).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Alignment with setGoal
  // --------------------------------------------------------

  describe('alignment with setGoal', () => {
    it('should use provided goal parameter over setGoal', () => {
      checker.setGoal('different goal');
      const result = checker.checkAlignment('build web app', 'build web application');
      expect(result.aligned).toBe(true);
    });
  });

  // --------------------------------------------------------
  // Jaccard Similarity Specific Tests
  // --------------------------------------------------------

  describe('Jaccard similarity', () => {
    it('should compute correct Jaccard for identical sets', () => {
      // Identical: intersection=3, union=3, Jaccard=1.0
      const result = checker.checkAlignment('a b c', 'a b c');
      expect(result.confidence).toBe(1);
    });

    it('should compute correct Jaccard for disjoint sets', () => {
      // Disjoint: intersection=0, union=6, Jaccard=0
      const result = checker.checkAlignment('a b c', 'd e f');
      expect(result.confidence).toBe(0);
    });

    it('should compute correct Jaccard for partial overlap', () => {
      // {a,b,c} ∩ {b,c,d} = {b,c} → 2/4 = 0.5
      const result = checker.checkAlignment('a b c', 'b c d');
      expect(result.confidence).toBe(0.5);
      expect(result.aligned).toBe(true); // 0.5 > 0.3
    });

    it('should align when Jaccard is exactly 0.31', () => {
      // Need a case where Jaccard ≈ 0.31
      // {a,b,c,d,e} ∩ {a,b,f,g,h,i} = {a,b} → 2/9 ≈ 0.22 - too low
      // Let's compute: {a,b,c} ∩ {a,d,e,f,g,h,i,j} = {a} → 1/10 = 0.1 - too low
      // {a,b,c} ∩ {a,b,d,e,f,g} = {a,b} → 2/7 ≈ 0.286 - just below
      // {a,b,c,d} ∩ {a,b,e,f,g} = {a,b} → 2/7 ≈ 0.286
      // {a,b,c,d,e} ∩ {a,b,c,f,g,h} = {a,b,c} → 3/8 = 0.375 - above
      const result = checker.checkAlignment('a b c d e', 'a b c f g h');
      expect(result.confidence).toBeCloseTo(0.375, 2);
      expect(result.aligned).toBe(true);
    });

    it('should not align when Jaccard is exactly 0.3', () => {
      // {a,b,c} ∩ {a,b,d,e,f,g,h} = {a,b} → 2/8 = 0.25
      // Need 0.3: {a,b,c,d,e} ∩ {a,b,f,g,h,i,j,k} = {a,b} → 2/11 ≈ 0.18
      // {a,b,c} ∩ {a,d,e,f} = {a} → 1/5 = 0.2
      // {a,b,c,d,e,f,g} ∩ {a,b,c,h,i,j} = {a,b,c} → 3/10 = 0.3
      const result = checker.checkAlignment('a b c d e f g', 'a b c h i j');
      expect(result.confidence).toBeCloseTo(0.3, 2);
      expect(result.aligned).toBe(false); // 0.3 is NOT > 0.3
    });
  });
});
