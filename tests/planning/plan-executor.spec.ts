/**
 * Unit tests for src/planning/plan-executor.ts
 *
 * Tests PlanExecutor with sequential/parallel execution, step execution,
 * progress tracking, failure handling, and checkpoint resume.
 * TDD RED phase - tests written before implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlanExecutorImpl } from '../../src/planning/plan-executor.js';
import type {
  ExecutionPlan,
  PlanStep,
  ExecutionResult,
  StepResult,
  PlanProgress,
} from '../../src/planning/types.js';
import type { ToolRegistry, ToolDefinition } from '../../src/core/interfaces.js';

// ============================================================
// Mock ToolRegistry
// ============================================================

function createMockToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  const registry: ToolRegistry = {
    list: () => [...tools.keys()],
    has: (name: string) => tools.has(name),
    get: (name: string) => tools.get(name),
    getFunctionDef: (name: string) => {
      const tool = tools.get(name);
      if (!tool) return undefined;
      return {
        name: tool.name,
        description: tool.description,
        parameters: { type: 'object' as const, properties: {} },
      };
    },
    getFunctionDefs: () =>
      [...tools.values()].map(t => ({
        name: t.name,
        description: t.description,
        parameters: { type: 'object' as const, properties: {} },
      })),
    execute: async (name: string, args: Record<string, unknown>) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool not found: ${name}`);
      return tool.execute(args);
    },
    register: (tool: ToolDefinition) => {
      tools.set(tool.name, tool);
    },
    registerAll: (toolList: ToolDefinition[]) => {
      for (const tool of toolList) {
        tools.set(tool.name, tool);
      }
    },
  };

  return registry;
}

function createSuccessTool(name: string, result = 'success'): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: {},
    execute: async () => result,
  };
}

function createFailTool(name: string, errorMsg = 'tool failed'): ToolDefinition {
  return {
    name,
    description: `${name} tool (fails)`,
    parameters: {},
    execute: async () => {
      throw new Error(errorMsg);
    },
  };
}

function createSlowTool(name: string, delayMs: number, result = 'done'): ToolDefinition {
  return {
    name,
    description: `${name} tool (slow)`,
    parameters: {},
    execute: async () => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return result;
    },
  };
}

// ============================================================
// Helper: Create test plans
// ============================================================

function createSequentialPlan(): ExecutionPlan {
  return {
    id: 'seq-plan',
    steps: [
      { id: 'step-1', toolName: 'read', args: { path: 'config.json' }, status: 'pending' },
      { id: 'step-2', toolName: 'write', args: { path: 'output.txt' }, dependsOn: ['step-1'], status: 'pending' },
    ],
    createdAt: Date.now(),
  };
}

function createParallelPlan(): ExecutionPlan {
  return {
    id: 'parallel-plan',
    steps: [
      { id: 'step-1', toolName: 'read', args: { path: 'a.txt' }, status: 'pending' },
      { id: 'step-2', toolName: 'read', args: { path: 'b.txt' }, status: 'pending' },
      { id: 'step-3', toolName: 'write', args: { path: 'merged.txt' }, dependsOn: ['step-1', 'step-2'], status: 'pending' },
    ],
    createdAt: Date.now(),
  };
}

// ============================================================
// PlanExecutor Tests
// ============================================================

describe('PlanExecutor', () => {
  let executor: PlanExecutorImpl;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    toolRegistry = createMockToolRegistry();
    executor = new PlanExecutorImpl();
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('execute() should execute steps in order', () => {
    it('should execute sequential steps and return completed status', async () => {
      toolRegistry.register(createSuccessTool('read'));
      toolRegistry.register(createSuccessTool('write'));

      const plan = createSequentialPlan();
      const result = await executor.execute(plan, toolRegistry);

      expect(result.planId).toBe('seq-plan');
      expect(result.status).toBe('completed');
      expect(result.stepResults.size).toBe(2);
    });

    it('should execute dependent steps after their dependencies', async () => {
      const executionOrder: string[] = [];

      toolRegistry.register({
        ...createSuccessTool('read'),
        execute: async () => {
          executionOrder.push('read');
          return 'read done';
        },
      });
      toolRegistry.register({
        ...createSuccessTool('write'),
        execute: async () => {
          executionOrder.push('write');
          return 'write done';
        },
      });

      const plan = createSequentialPlan();
      await executor.execute(plan, toolRegistry);

      expect(executionOrder).toEqual(['read', 'write']);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('execute() should run independent steps concurrently', () => {
    it('should execute independent steps concurrently', async () => {
      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      vi.useFakeTimers();

      toolRegistry.register({
        ...createSlowTool('read', 50),
        execute: async () => {
          startTimes['step-1'] = Date.now();
          await new Promise(resolve => setTimeout(resolve, 50));
          endTimes['step-1'] = Date.now();
          return 'a done';
        },
      });

      // Register a second read tool variant - but since tool registry uses tool name,
      // both steps use 'read'. We need different tool names for parallel test.
      toolRegistry.register(createSuccessTool('search'));

      const parallelPlan: ExecutionPlan = {
        id: 'parallel-test',
        steps: [
          { id: 'step-1', toolName: 'read', args: { path: 'a.txt' }, status: 'pending' },
          { id: 'step-2', toolName: 'search', args: { query: 'b' }, status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const resultPromise = executor.execute(parallelPlan, toolRegistry);
      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;
      vi.useRealTimers();

      expect(result.status).toBe('completed');
      expect(result.stepResults.size).toBe(2);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('executeStep() should return success result', () => {
    it('should return success result for successful tool execution', async () => {
      toolRegistry.register(createSuccessTool('read', 'file contents'));

      const step: PlanStep = {
        id: 'step-1',
        toolName: 'read',
        args: { path: 'config.json' },
        status: 'pending',
      };

      const result = await executor.executeStep(step, toolRegistry);

      expect(result.stepId).toBe('step-1');
      expect(result.status).toBe('completed');
      expect(result.output).toBe('file contents');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('executeStep() should return failure result', () => {
    it('should return failure result when tool throws', async () => {
      toolRegistry.register(createFailTool('write', 'disk full'));

      const step: PlanStep = {
        id: 'step-1',
        toolName: 'write',
        args: { path: 'output.txt' },
        status: 'pending',
      };

      const result = await executor.executeStep(step, toolRegistry);

      expect(result.stepId).toBe('step-1');
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error).toContain('disk full');
    });

    it('should return failure result when tool not found', async () => {
      const step: PlanStep = {
        id: 'step-1',
        toolName: 'nonexistent',
        args: {},
        status: 'pending',
      };

      const result = await executor.executeStep(step, toolRegistry);

      expect(result.stepId).toBe('step-1');
      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('getProgress() should return correct progress', () => {
    it('should return initial progress with zero completed', () => {
      const progress = executor.getProgress();

      expect(progress.totalSteps).toBe(0);
      expect(progress.completedSteps).toBe(0);
      expect(progress.failedSteps).toBe(0);
    });

    it('should track progress during execution', async () => {
      toolRegistry.register(createSuccessTool('read'));
      toolRegistry.register(createSuccessTool('write'));

      const plan = createSequentialPlan();
      await executor.execute(plan, toolRegistry);

      const progress = executor.getProgress();

      expect(progress.totalSteps).toBe(2);
      expect(progress.completedSteps).toBe(2);
      expect(progress.failedSteps).toBe(0);
    });

    it('should track failed steps in progress', async () => {
      toolRegistry.register(createSuccessTool('read'));
      toolRegistry.register(createFailTool('write'));

      const plan = createSequentialPlan();
      await executor.execute(plan, toolRegistry);

      const progress = executor.getProgress();

      expect(progress.failedSteps).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('execute() should stop on step failure', () => {
    it('should stop execution when a step fails', async () => {
      const executedSteps: string[] = [];

      toolRegistry.register({
        ...createFailTool('read', 'read failed'),
        execute: async () => {
          executedSteps.push('step-1');
          throw new Error('read failed');
        },
      });
      toolRegistry.register({
        ...createSuccessTool('write'),
        execute: async () => {
          executedSteps.push('step-2');
          return 'done';
        },
      });

      const plan = createSequentialPlan();
      const result = await executor.execute(plan, toolRegistry);

      expect(result.status).toBe('failed');
      expect(executedSteps).toEqual(['step-1']);
      // step-2 should not have executed because it depends on step-1
      expect(executedSteps).not.toContain('step-2');
    });

    it('should not execute steps that depend on failed steps', async () => {
      toolRegistry.register(createFailTool('read'));
      toolRegistry.register(createSuccessTool('write'));

      const plan = createSequentialPlan();
      const result = await executor.execute(plan, toolRegistry);

      expect(result.status).toBe('failed');
      const writeResult = result.stepResults.get('step-2');
      expect(writeResult).toBeUndefined();
    });
  });

  // --------------------------------------------------------
    // --------------------------------------------------------

  describe('execute() should support checkpoint resume', () => {
    it('should resume from checkpoint - skip already completed steps', async () => {
      const executedSteps: string[] = [];

      toolRegistry.register({
        ...createSuccessTool('read'),
        execute: async () => {
          executedSteps.push('step-1');
          return 'read done';
        },
      });
      toolRegistry.register({
        ...createSuccessTool('write'),
        execute: async () => {
          executedSteps.push('step-2');
          return 'write done';
        },
      });

      // Create a plan with step-1 already completed
      const resumedPlan: ExecutionPlan = {
        id: 'resume-plan',
        steps: [
          { id: 'step-1', toolName: 'read', args: { path: 'config.json' }, status: 'completed' },
          { id: 'step-2', toolName: 'write', args: { path: 'output.txt' }, dependsOn: ['step-1'], status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await executor.execute(resumedPlan, toolRegistry);

      expect(result.status).toBe('completed');
      // step-1 was already completed, should not re-execute
      expect(executedSteps).toEqual(['step-2']);
    });

    it('should preserve results from completed steps on resume', async () => {
      toolRegistry.register(createSuccessTool('read', 'cached content'));
      toolRegistry.register(createSuccessTool('write'));

      const resumedPlan: ExecutionPlan = {
        id: 'resume-plan-2',
        steps: [
          { id: 'step-1', toolName: 'read', args: { path: 'config.json' }, status: 'completed' },
          { id: 'step-2', toolName: 'write', args: { path: 'output.txt' }, dependsOn: ['step-1'], status: 'pending' },
        ],
        createdAt: Date.now(),
      };

      const result = await executor.execute(resumedPlan, toolRegistry);

      expect(result.stepResults.size).toBe(2);
      // The completed step should still have a result entry
      expect(result.stepResults.has('step-1')).toBe(true);
      expect(result.stepResults.has('step-2')).toBe(true);
    });
  });
});
