/**
 * Lifecycle Handler Tests — Planner Fire-and-Forget Wiring (Phase 1)
 *
 * Tests for ctx.planner.plan() call in handleAgentStart:
 * 1. When planner is configured, planner.plan() is called with the input
 * 2. When planner is not configured (undefined), nothing happens
 * 3. When planner.plan() rejects, it doesn't crash the loop
 */

import { describe, it, expect, vi } from 'vitest';
import { Subject, firstValueFrom, toArray } from 'rxjs';
import { handleAgentStart } from '../../../src/loop/handlers/lifecycle.js';
import type { HandlerDeps, StepContext } from '../../../src/loop/agent-loop.js';
import type { AgentContext, AgentState, AgentEvent } from '../../../src/core/index.js';
import { InMemoryStore, DefaultPauseController, SimpleSchemaRegistry } from '../../../src/core/index.js';
import type { ToolRegistry, FunctionDefinition, AuditLogger } from '../../../src/core/interfaces.js';
import type { Planner, ExecutionPlan, PlannerContext } from '../../../src/planning/types.js';

// ============================================================
// Mock Factories
// ============================================================

function createMockToolRegistry(): ToolRegistry {
  return {
    list: () => ['read', 'write', 'bash'],
    has: () => false,
    get: () => undefined,
    getFunctionDef: () => undefined,
    getFunctionDefs: (): FunctionDefinition[] => [],
    execute: async () => '',
    register: () => {},
    registerAll: () => {},
  };
}

function createMockPlanner(overrides: Partial<Planner> = {}): Planner {
  return {
    plan: vi.fn().mockResolvedValue({
      id: 'plan-1',
      steps: [
        { id: 'step-1', toolName: 'read', args: {}, status: 'pending' },
      ],
      createdAt: Date.now(),
    } satisfies ExecutionPlan),
    validate: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    ...overrides,
  };
}

function createMockAuditLogger(): AuditLogger {
  return {
    append: vi.fn(),
  };
}

function createTestContext(
  extras: Partial<AgentContext> = {},
): AgentContext {
  const tools = createMockToolRegistry();
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => null!, listProviders: () => [], hasProvider: () => false },
      toolRegistry: tools,
    },
    llm: null!,
    tools,
    ...extras,
  };
}

function createTestState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    model: { provider: 'mock', model: 'test-model' },
    messages: [{ role: 'user', content: 'Hello' }],
    step: 0,
    maxSteps: 10,
    pendingToolCalls: [],
    output: '',
    tokens: { prompt: 0, completion: 0 },
    ...overrides,
  };
}

function createTestDeps(ctx: AgentContext): HandlerDeps {
  const destroy$ = new Subject<void>();
  return {
    ctx,
    config: {
      model: { provider: 'mock', model: 'test-model' },
      maxSteps: 10,
      maxLLMRepairAttempts: 3,
      parallelToolCalls: true,
    },
    sessionId: 'test-session',
    destroy$: destroy$.asObservable(),
  };
}

// ============================================================
// Tests: Planner fire-and-forget in handleAgentStart
// ============================================================

describe('handleAgentStart — planner fire-and-forget', () => {
  it('should call planner.plan() with user input when planner is configured', async () => {
    const planner = createMockPlanner();
    const auditLogger = createMockAuditLogger();
    const ctx = createTestContext({ planner, auditLogger });
    const deps = createTestDeps(ctx);
    const state = createTestState({
      messages: [{ role: 'user', content: 'What is TypeScript?' }],
    });

    const event: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test-session',
      input: 'What is TypeScript?',
      agentName: 'test-agent',
      model: { provider: 'mock', model: 'test-model' },
    };

    const events = await firstValueFrom(
      handleAgentStart(deps, state, event).pipe(toArray()),
    );

    // Wait for fire-and-forget Promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // planner.plan() should have been called with the user input
    expect(planner.plan).toHaveBeenCalledWith('What is TypeScript?', {
      availableTools: ['read', 'write', 'bash'],
      maxSteps: 10,
    });

    // Audit logger should have been called with plan.generated
    expect(auditLogger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session',
        agentName: 'test-agent',
        eventType: 'agent.start',
        action: 'plan.generated',
        resource: 'What is TypeScript?',
        result: 'success',
        details: { planId: 'plan-1', stepCount: 1 },
      }),
    );

    // Events should still be emitted normally (planner doesn't block)
    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('agent.step');
    expect(events[1]!.event.type).toBe('llm.request');
  });

  it('should NOT call planner when planner is not configured', async () => {
    const ctx = createTestContext(); // no planner
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const event: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test-session',
      input: 'Hello',
      agentName: 'test-agent',
      model: { provider: 'mock', model: 'test-model' },
    };

    const events = await firstValueFrom(
      handleAgentStart(deps, state, event).pipe(toArray()),
    );

    // Should still emit step + llm.request events
    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('agent.step');
    expect(events[1]!.event.type).toBe('llm.request');
  });

  it('should NOT crash the loop when planner.plan() rejects', async () => {
    const planner = createMockPlanner({
      plan: vi.fn().mockRejectedValue(new Error('Planner service unavailable')),
    });
    const auditLogger = createMockAuditLogger();
    const ctx = createTestContext({ planner, auditLogger });
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const event: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test-session',
      input: 'Hello',
      agentName: 'test-agent',
      model: { provider: 'mock', model: 'test-model' },
    };

    // Should NOT throw — the rejection is caught silently
    const events = await firstValueFrom(
      handleAgentStart(deps, state, event).pipe(toArray()),
    );

    // Wait for fire-and-forget Promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Events should still be emitted normally
    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('agent.step');
    expect(events[1]!.event.type).toBe('llm.request');

    // Audit logger should NOT have been called (plan failed)
    expect(auditLogger.append).not.toHaveBeenCalled();
  });

  it('should use empty string when last message has no content', async () => {
    const planner = createMockPlanner();
    const ctx = createTestContext({ planner });
    const deps = createTestDeps(ctx);
    const state = createTestState({ messages: [] });

    const event: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test-session',
      input: '',
      agentName: 'test-agent',
      model: { provider: 'mock', model: 'test-model' },
    };

    await firstValueFrom(
      handleAgentStart(deps, state, event).pipe(toArray()),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should call plan with empty string when no messages
    expect(planner.plan).toHaveBeenCalledWith('', {
      availableTools: ['read', 'write', 'bash'],
      maxSteps: 10,
    });
  });

  it('should use optional chaining for auditLogger (no crash when auditLogger is missing)', async () => {
    const planner = createMockPlanner();
    const ctx = createTestContext({ planner }); // no auditLogger
    const deps = createTestDeps(ctx);
    const state = createTestState();

    const event: AgentEvent = {
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test-session',
      input: 'Hello',
      agentName: 'test-agent',
      model: { provider: 'mock', model: 'test-model' },
    };

    // Should NOT throw even without auditLogger
    const events = await firstValueFrom(
      handleAgentStart(deps, state, event).pipe(toArray()),
    );

    // Events should still be emitted
    expect(events).toHaveLength(2);
  });
});
