/**
 * Unit tests for src/planning/planner.ts
 *
 * Tests Planner with plan generation and validation.
 * TDD RED phase - tests written before implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlannerImpl } from '../../src/planning/planner.js';
import type { Planner, ExecutionPlan, PlannerContext, ValidationResult } from '../../src/planning/types.js';

// ============================================================
// Planner Tests
// ============================================================

describe('Planner', () => {
  let planner: Planner;
  let context: PlannerContext;

  beforeEach(() => {
    planner = new PlannerImpl();
    context = {
      availableTools: ['read', 'write', 'bash', 'search', 'edit'],
      maxSteps: 10,
    };
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('plan() should generate an execution plan', () => {
    it('should return an ExecutionPlan object', async () => {
      const plan = await planner.plan('Read the file config.json', context);

      expect(plan).toBeDefined();
      expect(plan.id).toBeDefined();
      expect(typeof plan.id).toBe('string');
      expect(plan.steps).toBeDefined();
      expect(Array.isArray(plan.steps)).toBe(true);
      expect(plan.createdAt).toBeDefined();
      expect(typeof plan.createdAt).toBe('number');
    });

    it('should generate a unique plan ID', async () => {
      const plan1 = await planner.plan('Read config.json', context);
      const plan2 = await planner.plan('Write output.txt', context);

      expect(plan1.id).not.toBe(plan2.id);
    });

    it('should set createdAt to current timestamp', async () => {
      const before = Date.now();
      const plan = await planner.plan('Read config.json', context);
      const after = Date.now();

      expect(plan.createdAt).toBeGreaterThanOrEqual(before);
      expect(plan.createdAt).toBeLessThanOrEqual(after);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('plan() should contain a steps list', () => {
    it('should return non-empty steps for valid input', async () => {
      const plan = await planner.plan('Read config.json and write result to output.txt', context);

      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should return steps array even for simple input', async () => {
      const plan = await planner.plan('Read config.json', context);

      expect(plan.steps).toBeDefined();
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('plan() each step should have a tool name', () => {
    it('should have toolName on each step', async () => {
      const plan = await planner.plan('Read config.json and write output.txt', context);

      for (const step of plan.steps) {
        expect(step.toolName).toBeDefined();
        expect(typeof step.toolName).toBe('string');
        expect(step.toolName.length).toBeGreaterThan(0);
      }
    });

    it('should use tools from available tools list', async () => {
      const plan = await planner.plan('Read config.json', context);

      for (const step of plan.steps) {
        expect(context.availableTools).toContain(step.toolName);
      }
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('plan() steps should have unique IDs', () => {
    it('should assign unique IDs to all steps', async () => {
      const plan = await planner.plan('Read config.json, search for patterns, and write results', context);

      const ids = plan.steps.map(s => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have non-empty string IDs', async () => {
      const plan = await planner.plan('Read config.json', context);

      for (const step of plan.steps) {
        expect(step.id).toBeDefined();
        expect(typeof step.id).toBe('string');
        expect(step.id.length).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('validate() should return valid for valid plan', () => {
    it('should return valid for a well-formed plan', async () => {
      const plan = await planner.plan('Read config.json', context);
      const result = await planner.validate(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid for multi-step plan', async () => {
      const plan = await planner.plan('Read config.json and write output.txt', context);
      const result = await planner.validate(plan);

      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('validate() should return invalid for empty plan', () => {
    it('should return invalid for plan with no steps', async () => {
      const emptyPlan: ExecutionPlan = {
        id: 'empty-plan',
        steps: [],
        createdAt: Date.now(),
      };

      const result = await planner.validate(emptyPlan);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('validate() should reject plan exceeding maxSteps', () => {
    it('should return invalid when steps exceed maxSteps', async () => {
      const smallContext: PlannerContext = {
        availableTools: ['read', 'write', 'bash'],
        maxSteps: 2,
      };

      const planWithTooManySteps: ExecutionPlan = {
        id: 'too-many-steps',
        steps: [
          { id: 'step-1', toolName: 'read', args: {}, status: 'pending' },
          { id: 'step-2', toolName: 'write', args: {}, status: 'pending' },
          { id: 'step-3', toolName: 'bash', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(planWithTooManySteps, smallContext);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('maxSteps'))).toBe(true);
    });

    it('should return valid when steps equal maxSteps', async () => {
      const plan = await planner.plan('Read and write', context);
      // context.maxSteps is 10, so any plan within that should be valid
      const result = await planner.validate(plan);
      expect(result.valid).toBe(true);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('validate() should reject plan with invalid dependencies', () => {
    it('should return invalid when step depends on non-existent step', () => {
      const badPlan: ExecutionPlan = {
        id: 'bad-deps',
        steps: [
          { id: 'step-1', toolName: 'read', args: {}, status: 'pending' },
          {
            id: 'step-2',
            toolName: 'write',
            args: {},
            dependsOn: ['step-999'],
            status: 'pending',
          },
        ],
        createdAt: Date.now(),
      };

      const result = planner.validate(badPlan);

      // validate is async, but the check is sync
      return result.then(r => {
        expect(r.valid).toBe(false);
        expect(r.errors.some(e => e.message.includes('step-999'))).toBe(true);
      });
    });

    it('should return valid when dependencies reference existing steps', async () => {
      const goodPlan: ExecutionPlan = {
        id: 'good-deps',
        steps: [
          { id: 'step-1', toolName: 'read', args: {}, status: 'pending' },
          {
            id: 'step-2',
            toolName: 'write',
            args: {},
            dependsOn: ['step-1'],
            status: 'pending',
          },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(goodPlan);

      expect(result.valid).toBe(true);
    });
  });
});
