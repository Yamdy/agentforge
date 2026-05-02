/**
 * Unit tests for LLMPlanner (src/planning/llm-planner.ts)
 *
 * Tests LLM-driven plan generation, replanning, validation, and fallback behavior
 * using mock LLM adapters. All tests are pure unit tests with no real LLM calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LLMPlanner } from '../../src/planning/llm-planner.js';
import type {
  ExecutionPlan,
  PlannerContext,
  StepResult,
  PlanStep,
} from '../../src/planning/types.js';

// ============================================================
// Mock LLM Adapter
// ============================================================

class MockLLMAdapter {
  chat: any;
  name = 'mock-llm';
  provider = 'mock';

  /**
   * @param responses - Array of LLMResponse-like objects returned in order.
   *   Falls back to last response when exhausted.
   */
  constructor(responses: Array<{ content: string }>) {
    let callCount = 0;
    this.chat = async () => {
      const resp = responses[callCount++] ?? responses[responses.length - 1]!;
      return resp;
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function makeContext(overrides?: Partial<PlannerContext>): PlannerContext {
  return {
    availableTools: ['read', 'write', 'bash'],
    maxSteps: 10,
    ...overrides,
  };
}

/** Create a valid JSON step array string for mock responses */
function stepArrayJson(steps: Array<Partial<PlanStep>>): string {
  return JSON.stringify(steps);
}

// ============================================================
// LLMPlanner Tests
// ============================================================

describe('LLMPlanner', () => {
  let context: PlannerContext;

  beforeEach(() => {
    context = makeContext();
  });

  // ------------------------------------------------------------
  // plan()
  // ------------------------------------------------------------

  describe('plan()', () => {
    it('returns valid ExecutionPlan from LLM JSON response', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            {
              id: 'step-1',
              toolName: 'read',
              description: 'Read config file',
              args: { file: 'config.json' },
            },
            {
              id: 'step-2',
              toolName: 'write',
              description: 'Write output',
              args: { file: 'output.txt', content: 'result' },
              dependsOn: ['step-1'],
            },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Read config and write output', context);

      // Plan structure
      expect(plan.id).toBeDefined();
      expect(typeof plan.id).toBe('string');
      expect(plan.id).toMatch(/^plan-/);
      expect(plan.steps).toBeDefined();
      expect(Array.isArray(plan.steps)).toBe(true);
      expect(plan.steps).toHaveLength(2);
      expect(typeof plan.createdAt).toBe('number');

      // Step 1
      expect(plan.steps[0]!.id).toBe('step-1');
      expect(plan.steps[0]!.toolName).toBe('read');
      expect(plan.steps[0]!.description).toBe('Read config file');
      expect(plan.steps[0]!.args).toEqual({ file: 'config.json' });
      expect(plan.steps[0]!.status).toBe('pending');
      expect(plan.steps[0]!.dependsOn).toBeUndefined();

      // Step 2
      expect(plan.steps[1]!.id).toBe('step-2');
      expect(plan.steps[1]!.toolName).toBe('write');
      expect(plan.steps[1]!.dependsOn).toEqual(['step-1']);
      expect(plan.steps[1]!.status).toBe('pending');
    });

    it('handles markdown code block wrapping', async () => {
      const innerJson = JSON.stringify([
        { id: 's1', toolName: 'read', args: { file: 'data.csv' } },
        { id: 's2', toolName: 'bash', args: { command: 'wc -l data.csv' } },
      ]);

      const mock = new MockLLMAdapter([
        {
          content: `Here is the plan:\n\`\`\`json\n${innerJson}\n\`\`\`\nHope this helps!`,
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Analyze data.csv', context);

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]!.id).toBe('s1');
      expect(plan.steps[0]!.toolName).toBe('read');
      expect(plan.steps[1]!.id).toBe('s2');
      expect(plan.steps[1]!.toolName).toBe('bash');
    });

    it('handles non-json code block wrapping (no language tag)', async () => {
      const innerJson = JSON.stringify([
        { id: 'x1', toolName: 'write', args: { file: 'out.txt' } },
      ]);

      const mock = new MockLLMAdapter([
        { content: `\`\`\`\n${innerJson}\n\`\`\`` },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Write output', context);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('x1');
      expect(plan.steps[0]!.toolName).toBe('write');
    });

    it('falls back to single-step plan on LLM error', async () => {
      const mock = new MockLLMAdapter([
        { content: '' }, // will throw
      ]);
      // Override chat to throw
      mock.chat = async () => {
        throw new Error('LLM connection refused');
      };

      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Read config file', context);

      // Fallback creates single step with first available tool
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('fallback-step-1');
      expect(plan.steps[0]!.toolName).toBe('read'); // first tool
      expect(plan.steps[0]!.description).toContain('Fallback');
      expect(plan.steps[0]!.status).toBe('pending');
      expect(plan.steps[0]!.args).toHaveProperty('input');
    });

    it('falls back on invalid JSON', async () => {
      const mock = new MockLLMAdapter([
        { content: 'This is not JSON at all, just some random text' },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Do something', context);

      // Should fall back to single-step plan
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('fallback-step-1');
      expect(plan.steps[0]!.toolName).toBe('read');
    });

    it('falls back on valid JSON that is not an array', async () => {
      const mock = new MockLLMAdapter([
        { content: JSON.stringify({ notAnArray: true, value: 42 }) },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Do something', context);

      // Zod validation fails because it expects an array
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('fallback-step-1');
    });

    it('falls back when step references unknown tool', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            { id: 'bad', toolName: 'nonexistent_tool', args: {} },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Use bad tool', context);

      // parseResponse validates tool names exist → throws → fallback
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('fallback-step-1');
    });

    it('falls back when step count exceeds maxSteps', async () => {
      const tinyContext = makeContext({ maxSteps: 2 });
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            { id: 'a', toolName: 'read', args: {} },
            { id: 'b', toolName: 'write', args: {} },
            { id: 'c', toolName: 'bash', args: {} },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Do three things', tinyContext);

      // parseResponse throws because 3 > 2 → fallback
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('fallback-step-1');
    });

    it('falls back when dependsOn references non-existent step', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            {
              id: 'step-a',
              toolName: 'read',
              args: {},
              dependsOn: ['step-z'], // doesn't exist
            },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Bad dependencies', context);

      // parseResponse validates dependsOn → throws → fallback
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]!.id).toBe('fallback-step-1');
    });

    it('preserves optional description and dependsOn fields', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            { id: 'base', toolName: 'read', args: {} },
            {
              id: 'next',
              toolName: 'write',
              args: {},
              description: 'Write results',
              dependsOn: ['base'],
            },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Read then write', context);

      expect(plan.steps[1]!.description).toBe('Write results');
      expect(plan.steps[1]!.dependsOn).toEqual(['base']);
    });

    it('sets status to pending on all generated steps', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            { id: 's1', toolName: 'read', args: {} },
            { id: 's2', toolName: 'write', args: {} },
            { id: 's3', toolName: 'bash', args: {} },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const plan = await planner.plan('Multi-step task', context);

      for (const step of plan.steps) {
        expect(step.status).toBe('pending');
      }
    });
  });

  // ------------------------------------------------------------
  // replan()
  // ------------------------------------------------------------

  describe('replan()', () => {
    it('preserves completed steps and merges new ones', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            { id: 'step-3', toolName: 'write', args: { file: 'output.txt' } },
            { id: 'step-4', toolName: 'bash', args: { command: 'verify' }, dependsOn: ['step-3'] },
          ]),
        },
      ]);
      const planner = new LLMPlanner(mock);

      const completedResults = new Map<string, StepResult>();
      completedResults.set('step-1', {
        stepId: 'step-1',
        status: 'completed',
        output: 'config read successfully',
        durationMs: 50,
      });
      completedResults.set('step-2', {
        stepId: 'step-2',
        status: 'failed',
        error: 'tool timeout',
        durationMs: 5000,
      });

      const plan = await planner.replan(
        'Read config, process, write output',
        context,
        'step-2', // failed step
        completedResults,
      );

      // Completed step-1 preserved
      expect(plan.steps).toHaveLength(4);

      // Step-1: completed
      const step1 = plan.steps.find((s) => s.id === 'step-1');
      expect(step1).toBeDefined();
      expect(step1!.status).toBe('completed');
      expect(step1!.toolName).toBe('');

      // Step-2: failed
      const step2 = plan.steps.find((s) => s.id === 'step-2');
      expect(step2).toBeDefined();
      expect(step2!.status).toBe('failed');

      // New steps from LLM
      const step3 = plan.steps.find((s) => s.id === 'step-3');
      expect(step3).toBeDefined();
      expect(step3!.status).toBe('pending');
      expect(step3!.toolName).toBe('write');

      const step4 = plan.steps.find((s) => s.id === 'step-4');
      expect(step4).toBeDefined();
      expect(step4!.dependsOn).toEqual(['step-3']);
    });

    it('respects maxReplanAttempts', async () => {
      const mock = new MockLLMAdapter([
        {
          content: JSON.stringify([
            { id: 'retry-1', toolName: 'read', args: {} },
          ]),
        },
      ]);
      // maxReplanAttempts = 1: first replan succeeds, second hits limit
      const planner = new LLMPlanner(mock, 1);

      const completedResults = new Map<string, StepResult>();
      completedResults.set('done-1', {
        stepId: 'done-1',
        status: 'completed',
        output: 'ok',
        durationMs: 10,
      });

      // First replan: within limit → calls LLM
      const plan1 = await planner.replan(
        'Retry task',
        context,
        'failed-step',
        completedResults,
      );
      // Should have both completed and new steps
      expect(plan1.steps.some((s) => s.id === 'done-1')).toBe(true);
      expect(plan1.steps.some((s) => s.id === 'retry-1')).toBe(true);

      // Second replan: exceeds limit → completed-only
      const plan2 = await planner.replan(
        'Retry task again',
        context,
        'another-fail',
        completedResults,
      );
      // Should only have completed steps (no LLM call)
      expect(plan2.steps).toHaveLength(1);
      expect(plan2.steps[0]!.id).toBe('done-1');
      expect(plan2.steps[0]!.status).toBe('completed');
    });
  });

  // ------------------------------------------------------------
  // validate()
  // ------------------------------------------------------------

  describe('validate()', () => {
    it('returns valid for a well-formed plan', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const plan: ExecutionPlan = {
        id: 'test-plan',
        steps: [
          { id: 's1', toolName: 'read', args: {}, status: 'pending' },
          { id: 's2', toolName: 'write', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects plan with no steps', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const plan: ExecutionPlan = {
        id: 'empty',
        steps: [],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, context);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('at least one step'))).toBe(true);
    });

    it('checks tool existence in availableTools (LLM-specific)', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const plan: ExecutionPlan = {
        id: 'bad-tool',
        steps: [
          { id: 's1', toolName: 'read', args: {}, status: 'pending' },
          { id: 's2', toolName: 'nonexistent_tool', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, context);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('toolName'))).toBe(true);
      expect(result.errors.some((e) => e.message.includes('nonexistent_tool'))).toBe(true);
    });

    it('checks step count limit', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const smallContext = makeContext({ maxSteps: 2 });
      const plan: ExecutionPlan = {
        id: 'too-many',
        steps: [
          { id: 'a', toolName: 'read', args: {}, status: 'pending' },
          { id: 'b', toolName: 'write', args: {}, status: 'pending' },
          { id: 'c', toolName: 'bash', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, smallContext);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('maxSteps'))).toBe(true);
      expect(result.errors.some((e) => e.message.includes('3'))).toBe(true);
    });

    it('rejects duplicate step IDs', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const plan: ExecutionPlan = {
        id: 'dupes',
        steps: [
          { id: 'same-id', toolName: 'read', args: {}, status: 'pending' },
          { id: 'same-id', toolName: 'write', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, context);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Duplicate step ID'))).toBe(true);
    });

    it('rejects plan where dependsOn references non-existent step', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const plan: ExecutionPlan = {
        id: 'bad-deps',
        steps: [
          { id: 's1', toolName: 'read', args: {}, status: 'pending' },
          {
            id: 's2',
            toolName: 'write',
            args: {},
            dependsOn: ['s1', 's-ghost'], // s-ghost doesn't exist
            status: 'pending',
          },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, context);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('s-ghost'))).toBe(true);
    });

    it('does not check tool existence when context is omitted', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const plan: ExecutionPlan = {
        id: 'no-ctx',
        steps: [
          { id: 's1', toolName: 'imaginary_tool', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan); // no context

      // Tool check skipped when no context, but plan still has ≥1 step
      expect(result.valid).toBe(true);
    });

    it('accepts plan with exactly maxSteps', async () => {
      const planner = new LLMPlanner(new MockLLMAdapter([]));
      const tightContext = makeContext({ maxSteps: 3 });
      const plan: ExecutionPlan = {
        id: 'exact',
        steps: [
          { id: 'a', toolName: 'read', args: {}, status: 'pending' },
          { id: 'b', toolName: 'write', args: {}, status: 'pending' },
          { id: 'c', toolName: 'bash', args: {}, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await planner.validate(plan, tightContext);

      expect(result.valid).toBe(true);
    });
  });
});
