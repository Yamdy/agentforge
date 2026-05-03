/**
 * Unit tests for PlanNotebook (src/planning/plan-notebook.ts)
 *
 * Tests PlanNotebook tool registration, plan lifecycle management,
 * and request hook plan-hint injection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlanNotebook } from '../../src/planning/plan-notebook.js';
import type {
  Planner,
  PlannerContext,
  ExecutionPlan,
  PlanStep,
  PlanValidationResult,
  StepResult,
} from '../../src/planning/types.js';
import type {
  ToolRegistry,
  ToolDefinition,
  FunctionDefinition,
  ToolContext,
} from '../../src/core/interfaces.js';
import type { Message } from '../../src/core/events.js';
import type { AgentLoopState } from '../../src/core/state.js';
import { createInitialLoopState } from '../../src/core/state.js';

// ============================================================
// Helpers
// ============================================================

function makePlanStep(
  id: string,
  toolName: string,
  description: string,
  status: PlanStep['status'] = 'pending',
): PlanStep {
  return { id, toolName, description, args: {}, status };
}

function makePlan(
  id: string,
  steps: PlanStep[],
): ExecutionPlan {
  return { id, steps, createdAt: Date.now() };
}

function makeState(): AgentLoopState {
  return createInitialLoopState({
    sessionId: 'test-session',
    agentName: 'test-agent',
    model: { provider: 'openai', model: 'gpt-4o' },
    messages: [],
    maxSteps: 10,
  });
}

function makeSystemMsg(content: string): Message {
  return { role: 'user', content }; // will be modified in tests
}

// ============================================================
// Mock Planner
// ============================================================

class MockPlanner implements Planner {
  planCalls: Array<{ input: string; context: PlannerContext }> = [];
  replanCalls: Array<{
    input: string;
    context: PlannerContext;
    failedStepId: string;
    completedResults: Map<string, StepResult>;
  }> = [];

  private nextPlanId = 1;

  async plan(input: string, context: PlannerContext): Promise<ExecutionPlan> {
    this.planCalls.push({ input, context });
    const id = `plan-${this.nextPlanId++}`;
    return makePlan(id, [
      makePlanStep('step-1', 'read', 'Read config file'),
      makePlanStep('step-2', 'edit', 'Edit config values'),
      makePlanStep('step-3', 'write', 'Save config file'),
    ]);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async validate(_plan: ExecutionPlan): Promise<PlanValidationResult> {
    return { valid: true, errors: [] };
  }

  async replan(
    input: string,
    context: PlannerContext,
    failedStepId: string,
    completedResults: Map<string, StepResult>,
  ): Promise<ExecutionPlan> {
    this.replanCalls.push({ input, context, failedStepId, completedResults });
    const id = `plan-revised-${this.nextPlanId++}`;
    return makePlan(id, [
      makePlanStep('step-a', 'search', 'Search for alternatives'),
      makePlanStep('step-b', 'edit', 'Apply fix'),
    ]);
  }
}

// ============================================================
// Mock ToolRegistry
// ============================================================

class MockToolRegistry implements ToolRegistry {
  registeredTools: ToolDefinition[] = [];

  list(): string[] {
    return this.registeredTools.map((t) => t.name);
  }

  has(name: string): boolean {
    return this.registeredTools.some((t) => t.name === name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.registeredTools.find((t) => t.name === name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  getFunctionDef(_name: string): FunctionDefinition | undefined {
    return undefined;
  }

  getFunctionDefs(): FunctionDefinition[] {
    return [];
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    _ctx?: ToolContext,
  ): Promise<string> {
    const tool = this.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool.execute(args);
  }

  register(tool: ToolDefinition): void {
    this.registeredTools.push(tool);
  }

  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }
}

// ============================================================
// Test Suite
// ============================================================

describe('PlanNotebook', () => {
  let planner: MockPlanner;
  let context: PlannerContext;
  let registry: MockToolRegistry;
  let notebook: PlanNotebook;

  beforeEach(() => {
    planner = new MockPlanner();
    context = { availableTools: ['read', 'write', 'edit', 'search'], maxSteps: 10 };
    registry = new MockToolRegistry();
    notebook = new PlanNotebook(planner, context);
  });

  // ---- a. Constructor creates instance ----
  it('a. Constructor creates instance', () => {
    expect(notebook).toBeInstanceOf(PlanNotebook);
    expect(notebook.planHintHook).toBeDefined();
    expect(notebook.planHintHook.name).toBe('plan-notebook-hint');
    expect(notebook.planHintHook.priority).toBe(25);
  });

  // ---- b. registerTools registers 3 tools ----
  it('b. registerTools registers 3 tools', () => {
    notebook.registerTools(registry);
    expect(registry.list()).toHaveLength(3);
    expect(registry.has('create_plan')).toBe(true);
    expect(registry.has('finish_task')).toBe(true);
    expect(registry.has('revise_plan')).toBe(true);
  });

  // ---- c. create_plan returns plan summary ----
  it('c. create_plan returns plan summary', async () => {
    notebook.registerTools(registry);
    const tool = registry.get('create_plan')!;
    const result = await tool.execute({ task: 'Read and edit config' });
    expect(result).toContain('Plan created for "Read and edit config": 3 steps');
    expect(result).toContain('[1] Read config file');
    expect(result).toContain('[2] Edit config values');
    expect(result).toContain('[3] Save config file');
  });

  // ---- d. finish_task marks step complete and activates next ----
  it('d. finish_task marks step complete and activates next', async () => {
    notebook.registerTools(registry);

    const createTool = registry.get('create_plan')!;
    await createTool.execute({ task: 'Test task' });

    const finishTool = registry.get('finish_task')!;
    const result = await finishTool.execute({
      stepId: 'step-1',
      outcome: 'Config file read successfully',
    });
    expect(result).toContain('Step 1 done.');
    expect(result).toContain('Next: Edit config values');
  });

  // ---- e. finish_task on last step returns "Plan complete" ----
  it('e. finish_task on last step returns "Plan complete"', async () => {
    notebook.registerTools(registry);

    const createTool = registry.get('create_plan')!;
    await createTool.execute({ task: 'Test task' });

    const finishTool = registry.get('finish_task')!;
    await finishTool.execute({ stepId: 'step-1', outcome: 'Done 1' });
    await finishTool.execute({ stepId: 'step-2', outcome: 'Done 2' });
    const result = await finishTool.execute({
      stepId: 'step-3',
      outcome: 'Done 3',
    });
    expect(result).toContain('Plan complete. All 3 steps finished.');
  });

  // ---- f. finish_task with invalid stepId returns error ----
  it('f. finish_task with invalid stepId returns error', async () => {
    notebook.registerTools(registry);

    const createTool = registry.get('create_plan')!;
    await createTool.execute({ task: 'Test task' });

    const finishTool = registry.get('finish_task')!;
    const result = await finishTool.execute({
      stepId: 'nonexistent',
      outcome: 'Nothing',
    });
    expect(result).toContain("Error: Step 'nonexistent' not found in plan.");
  });

  // ---- g. revise_plan returns updated summary ----
  it('g. revise_plan returns updated summary', async () => {
    notebook.registerTools(registry);

    const createTool = registry.get('create_plan')!;
    await createTool.execute({ task: 'Test task' });

    // Mark step-1 as completed before revising
    const finishTool = registry.get('finish_task')!;
    await finishTool.execute({ stepId: 'step-1', outcome: 'Done' });

    const reviseTool = registry.get('revise_plan')!;
    const result = await reviseTool.execute({
      reason: 'Blocked',
      newInstructions: 'Try alternative approach',
    });
    expect(result).toContain('Plan revised: 2 steps (was 3)');
    expect(planner.replanCalls).toHaveLength(1);
    expect(planner.replanCalls[0]!.completedResults.size).toBe(1);
  });

  // ---- h. planHintHook injects hint when plan exists ----
  it('h. planHintHook injects hint when plan exists', async () => {
    notebook.registerTools(registry);
    const createTool = registry.get('create_plan')!;
    await createTool.execute({ task: 'Test task' });

    const state = makeState();
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    const result = notebook.planHintHook.apply(messages, state);
    expect(result[0]!.content).toContain('<plan-hint>Current step: step 1: Read config file</plan-hint>');
  });

  // ---- i. planHintHook returns unchanged when no plan ----
  it('i. planHintHook returns unchanged when no plan', () => {
    const state = makeState();
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ];

    const result = notebook.planHintHook.apply(messages, state);
    expect(result[0]!.content).toBe('You are a helpful assistant.');
    expect(result).toHaveLength(2);
  });

  // ---- j. Multiple create_plan calls replace existing plan ----
  it('j. Multiple create_plan calls replace existing plan', async () => {
    notebook.registerTools(registry);
    const createTool = registry.get('create_plan')!;

    // First plan
    const r1 = await createTool.execute({ task: 'First task' });
    expect(r1).toContain('Plan created for "First task": 3 steps');

    // Second plan replaces first
    const r2 = await createTool.execute({ task: 'Second task' });
    expect(r2).toContain('Plan created for "Second task": 3 steps');
    // Two calls both went through planner
    expect(planner.planCalls).toHaveLength(2);
    expect(planner.planCalls[0]!.input).toBe('First task');
    expect(planner.planCalls[1]!.input).toBe('Second task');
  });
});
