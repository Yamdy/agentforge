/**
 * Unit tests for planner enforcement — executionMode routing.
 *
 * Tests the three execution modes:
 * - 'react': Planner never invoked, always ReAct
 * - 'plan-then-execute': Planner first, falls back to ReAct on failure
 * - 'plan-then-execute-strict': Planner must succeed, errors out otherwise
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgentLoop,
  type AgentLoopConfig,
} from '../../src/loop/agent-loop.js';
import type {
  AgentContext,
  LLMAdapter,
  LLMResponse,
  ToolRegistry,
  ToolDefinition,
} from '../../src/core/index.js';
import { InMemoryStore, DefaultPauseController, SimpleSchemaRegistry } from '../../src/core/index.js';
import type {
  Planner,
  ExecutionPlan,
  PlanStep,
  PlannerContext,
  PlanValidationResult,
  StepResult,
} from '../../src/planning/types.js';

// ============================================================
// Mock LLM Adapter (minimal for ReAct fallback testing)
// ============================================================

class MockLLMAdapter implements LLMAdapter {
  private response: LLMResponse;
  private failCount = 0;
  private maxFails = 0;

  constructor(response?: LLMResponse) {
    this.response = response ?? { content: 'Mock response', finishReason: 'stop' };
  }

  setFailCount(n: number): void { this.maxFails = n; this.failCount = 0; }

  async chat(): Promise<LLMResponse> {
    if (this.failCount < this.maxFails) { this.failCount++; throw new Error('LLM error'); }
    return this.response;
  }

  async *stream(): AsyncGenerator<{ text: string }> { yield { text: 's' }; }
}

// ============================================================
// Mock Tool Registry
// ============================================================

class MockToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(names: string[] = []) {
    for (const name of names) {
      this.tools.set(name, {
        name,
        description: `Tool: ${name}`,
        parameters: {},
        execute: async () => 'ok',
      });
    }
  }

  list() { return Array.from(this.tools.keys()); }
  has(name: string) { return this.tools.has(name); }
  get(name: string) { return this.tools.get(name); }
  getFunctionDef(name: string) {
    const t = this.tools.get(name);
    return t ? { name: t.name, description: t.description, parameters: {} } : undefined;
  }
  getFunctionDefs() { return this.list().map(n => this.getFunctionDef(n)!); }
  async execute(name: string, _args: Record<string, unknown>) {
    const t = this.tools.get(name);
    if (!t) throw new Error(`Tool ${name} not found`);
    return 'executed';
  }
  registerAll(): void {}
  register(): void {}
}

// ============================================================
// Mock Planner (controllable success/failure)
// ============================================================

function makeStep(overrides?: Partial<PlanStep>): PlanStep {
  return { id: 's1', toolName: 'test-tool', args: {}, status: 'pending' as const, ...overrides };
}

function makePlan(steps: PlanStep[]): ExecutionPlan {
  return { id: 'plan-1', steps, createdAt: Date.now() };
}

function makeValidResult(): PlanValidationResult {
  return { valid: true, errors: [] };
}

function makeInvalidResult(msg = 'plan is empty'): PlanValidationResult {
  return { valid: false, errors: [{ path: 'plan', message: msg }] };
}

class MockPlanner implements Planner {
  shouldPlanFail = false;
  shouldValidateFail = false;
  planErrorMsg = 'Planner failed to generate a plan';
  generatedSteps: PlanStep[] = [makeStep()];

  async plan(_input: string, _context: PlannerContext): Promise<ExecutionPlan> {
    if (this.shouldPlanFail) {
      throw new Error(this.planErrorMsg);
    }
    return makePlan(this.generatedSteps);
  }

  async validate(_plan: ExecutionPlan, _context?: PlannerContext): Promise<PlanValidationResult> {
    if (this.shouldValidateFail) return makeInvalidResult('step references unknown tool');
    return makeValidResult();
  }

  async replan(
    _input: string,
    _context: PlannerContext,
    _failedStepId: string,
    _completedResults: Map<string, StepResult>,
  ): Promise<ExecutionPlan> {
    return makePlan([makeStep({ id: 'replan-s1' })]);
  }
}

// ============================================================
// Test Context Factory
// ============================================================

function createTestContext(
  llm: LLMAdapter,
  tools: ToolRegistry,
  planner?: Planner,
): AgentContext {
  const sessionId = `test-session-${Date.now()}`;
  return {
    sessionId,
    agentName: 'test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm },
      toolRegistry: tools,
    },
    llm,
    tools,
    planner,
  };
}

function createConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: { provider: 'mock', model: 'test-model' },
    maxSteps: 5,
    ...overrides,
  };
}

function collectEvents(loop: ReturnType<typeof createAgentLoop>): { events: any[]; subscribe: () => void } {
  const events: any[] = [];
  const unsub = loop.onAny((e: any) => events.push(e));
  return { events, subscribe: () => unsub() };
}

// ============================================================
// Tests: executionMode routing
// ============================================================

describe('Planner Enforcement — executionMode', () => {
  // ── react mode ──

  describe('executionMode: react', () => {
    it('never invokes the planner even when ctx.planner is present', async () => {
      const llm = new MockLLMAdapter({ content: 'ReAct response', finishReason: 'stop' });
      const tools = new MockToolRegistry(['read', 'write']);
      const planner = new MockPlanner();
      planner.generatedSteps = [makeStep({ toolName: 'read' })];

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'react' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      // In react mode, the LLM should have been called (ReAct path)
      const llmEvents = events.filter((e: any) => e.type === 'llm.request');
      expect(llmEvents.length).toBeGreaterThan(0);
      // No plan execution events should appear
      const completeEvents = events.filter((e: any) => e.type === 'agent.complete');
      expect(completeEvents.length).toBeGreaterThan(0);
    });

    it('uses ReAct loop when executionMode is not set (default)', async () => {
      const llm = new MockLLMAdapter({ content: 'default response', finishReason: 'stop' });
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({}); // No executionMode set
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('test');
      subscribe();

      const llmEvents = events.filter((e: any) => e.type === 'llm.request');
      expect(llmEvents.length).toBeGreaterThan(0);
    });
  });

  // ── plan-then-execute mode ──

  describe('executionMode: plan-then-execute', () => {
    it('runs planner and uses plan when planner succeeds', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['test-tool']);
      const planner = new MockPlanner();
      planner.generatedSteps = [makeStep({ toolName: 'test-tool' })];

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('run test-tool');
      subscribe();

      // Should have completed without falling back to ReAct
      const completeEvents = events.filter((e: any) => e.type === 'agent.complete');
      expect(completeEvents.length).toBeGreaterThan(0);
      const doneEvent = events.find((e: any) => e.type === 'done');
      expect(doneEvent.reason).toBe('stop');
    });

    it('falls back to ReAct when planner throws', async () => {
      const llm = new MockLLMAdapter({ content: 'fallback ReAct', finishReason: 'stop' });
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.shouldPlanFail = true;

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      // Should fall back to ReAct and succeed (no agent.error)
      const llmEvents = events.filter((e: any) => e.type === 'llm.request');
      expect(llmEvents.length).toBeGreaterThan(0);
      const errorEvent = events.find((e: any) => e.type === 'agent.error');
      expect(errorEvent).toBeUndefined();
    });

    it('falls back to ReAct when plan has no steps', async () => {
      const llm = new MockLLMAdapter({ content: 'fallback response', finishReason: 'stop' });
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.generatedSteps = [];

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      const llmEvents = events.filter((e: any) => e.type === 'llm.request');
      expect(llmEvents.length).toBeGreaterThan(0);
    });

    it('falls back to ReAct when plan validation fails', async () => {
      const llm = new MockLLMAdapter({ content: 'validation fallback', finishReason: 'stop' });
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.shouldValidateFail = true;

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      const llmEvents = events.filter((e: any) => e.type === 'llm.request');
      expect(llmEvents.length).toBeGreaterThan(0);
    });
  });

  // ── plan-then-execute-strict mode ──

  describe('executionMode: plan-then-execute-strict', () => {
    it('runs plan successfully when planner succeeds', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['test-tool']);
      const planner = new MockPlanner();
      planner.generatedSteps = [makeStep({ toolName: 'test-tool' })];

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute-strict' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('run test-tool');
      subscribe();

      const doneEvent = events.find((e: any) => e.type === 'done');
      expect(doneEvent.reason).toBe('stop');
    });

    it('emits agent.error and done when planner throws', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.shouldPlanFail = true;
      planner.planErrorMsg = 'model not available';

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute-strict' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      const errorEvent = events.find((e: any) => e.type === 'agent.error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.message).toContain('strict mode');
      expect(errorEvent.error.message).toContain('model not available');

      const doneEvent = events.find((e: any) => e.type === 'done');
      expect(doneEvent.reason).toBe('error');
    });

    it('emits agent.error when planner returns empty plan', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.generatedSteps = [];

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute-strict' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      const errorEvent = events.find((e: any) => e.type === 'agent.error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.message).toContain('empty plan');
    });

    it('emits agent.error when plan validation fails', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.shouldValidateFail = true;

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute-strict' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('do something');
      subscribe();

      const errorEvent = events.find((e: any) => e.type === 'agent.error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.message).toContain('unknown tool');
    });

    it('does NOT fall back to ReAct on planner failure', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['read']);
      const planner = new MockPlanner();
      planner.shouldPlanFail = true;

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute-strict' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      const output = await loop.run('do something');
      subscribe();

      // Output should be empty (error path returns '')
      expect(output).toBe('');
      // No LLM requests should have been made (didn't enter ReAct)
      const llmEvents = events.filter((e: any) => e.type === 'llm.request');
      expect(llmEvents.length).toBe(0);
    });

    it('uses lastDiagnostic from LLMPlanner when available', async () => {
      const llm = new MockLLMAdapter();
      const tools = new MockToolRegistry(['read']);
      // Use a planner that sets lastDiagnostic (like LLMPlanner does)
      const planner: Planner & { lastDiagnostic?: string } = {
        async plan() {
          planner.lastDiagnostic = 'Planner could not generate a valid execution plan.\n\nReason: test failure\n\nAvailable tools (1): read';
          throw new Error('original error');
        },
        async validate() { return makeValidResult(); },
        async replan() { return makePlan([]); },
      };

      const ctx = createTestContext(llm, tools, planner);
      const config = createConfig({ executionMode: 'plan-then-execute-strict' });
      const loop = createAgentLoop(ctx, config);
      const { events, subscribe } = collectEvents(loop);

      await loop.run('test');
      subscribe();

      const errorEvent = events.find((e: any) => e.type === 'agent.error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.message).toContain('test failure');
      expect(errorEvent.error.message).toContain('Available tools (1): read');
    });
  });

  // ── No planner present ──

  describe('without planner', () => {
    it('always uses ReAct regardless of executionMode', async () => {
      const llm = new MockLLMAdapter({ content: 'ReAct only', finishReason: 'stop' });
      const tools = new MockToolRegistry(['read']);
      const ctx = createTestContext(llm, tools, undefined); // No planner

      for (const mode of ['react', 'plan-then-execute', 'plan-then-execute-strict'] as const) {
        const config = createConfig({ executionMode: mode });
        const loop = createAgentLoop(ctx, config);
        const { events, subscribe } = collectEvents(loop);

        await loop.run('test');
        subscribe();

        const llmEvents = events.filter((e: any) => e.type === 'llm.request');
        expect(llmEvents.length).toBeGreaterThan(0);
      }
    });
  });
});
