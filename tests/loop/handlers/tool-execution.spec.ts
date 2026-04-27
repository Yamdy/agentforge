/**
 * Tool Execution Guard Tests
 *
 * Tests for the 4 guard points wired into src/loop/handlers/tool-execution.ts:
 * 1. permissionPolicy + permissionController — blocking guard before tool execution
 * 2. sandboxExecutor — routing for sandboxRequired tools
 * 3. securityGuard — command blocklist check
 * 4. errorClassifier — fire-and-forget on tool error path (in agent-loop.ts)
 *
 * Also tests the extracted executeToolDirectly function.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, from, firstValueFrom, toArray, Subject } from 'rxjs';
import {
  executeSingleTool,
  executeToolDirectly,
} from '../../../src/loop/handlers/tool-execution.js';
import type { HandlerDeps, StepContext } from '../../../src/loop/agent-loop.js';
import type { AgentContext, AgentState, AgentEvent } from '../../../src/core/index.js';
import { InMemoryStore, DefaultPauseController, SimpleSchemaRegistry, generateId } from '../../../src/core/index.js';
import type {
  LLMAdapter,
  ToolRegistry,
  ToolDefinition,
  FunctionDefinition,
  PermissionPolicy,
  PermissionController,
  PermissionDecision,
  PermissionAskOptions,
  SandboxExecutor,
  AuditLogger,
} from '../../../src/core/interfaces.js';
import type { SecurityGuard } from '../../../src/security/guard.js';

// ============================================================
// Mock Factories
// ============================================================

function createMockLLMAdapter(): LLMAdapter {
  return {
    name: 'mock-llm',
    provider: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: 'Hello!',
      finishReason: 'stop' as const,
    }),
    stream: vi.fn().mockReturnValue(of({ text: 'Hello!' })),
  };
}

function createMockToolRegistry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    list: () => ['test-tool'],
    has: () => true,
    get: () => ({
      name: 'test-tool',
      description: 'A test tool',
      parameters: {},
      execute: async () => 'tool result',
    }),
    getFunctionDef: () => undefined,
    getFunctionDefs: (): FunctionDefinition[] => [],
    execute: vi.fn().mockResolvedValue('tool result'),
    register: () => {},
    registerAll: () => {},
    ...overrides,
  };
}

function createMockPermissionPolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return {
    riskPolicies: {
      low: 'allow',
      medium: 'allow',
      high: 'ask',
      critical: 'deny',
    },
    defaultPolicy: 'allow',
    toolPolicies: {},
    enforceApprovalFlag: false,
    ...overrides,
  };
}

function createMockPermissionController(overrides: Partial<PermissionController> = {}): PermissionController {
  return {
    ask: vi.fn().mockReturnValue(of('allow' as PermissionDecision)),
    onAsk: vi.fn().mockReturnValue(of({
      promptId: 'test',
      permission: 'test',
      options: ['allow', 'deny'] as PermissionDecision[],
    })),
    answer: vi.fn(),
    isAutoAllowed: vi.fn().mockReturnValue(false),
    cancel: vi.fn(),
    ...overrides,
  };
}

function createMockSandboxExecutor(overrides: Partial<SandboxExecutor> = {}): SandboxExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      result: 'sandbox result',
      durationMs: 100,
    }),
    ...overrides,
  };
}

function createMockSecurityGuard(overrides: Partial<SecurityGuard> = {}): SecurityGuard {
  return {
    checkCommand: vi.fn().mockReturnValue({ allowed: true }),
    checkPath: vi.fn().mockReturnValue({ allowed: true }),
    checkNetwork: vi.fn().mockReturnValue({ allowed: true }),
    ...overrides,
  } as unknown as SecurityGuard;
}

function createMockAuditLogger(): AuditLogger {
  return {
    append: vi.fn(),
  };
}

function createTestContext(
  toolRegistry: ToolRegistry,
  extras: Partial<AgentContext> = {},
): AgentContext {
  const llm = createMockLLMAdapter();
  return {
    sessionId: 'test-session',
    agentName: 'test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm, listProviders: () => [], hasProvider: () => false },
      toolRegistry,
    },
    llm,
    tools: toolRegistry,
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

function createTestToolCall() {
  return {
    id: `tc-${generateId()}`,
    name: 'test-tool',
    args: { input: 'test' },
  };
}

// ============================================================
// Tests: Permission Policy Check
// ============================================================

describe('permissionPolicy check in executeSingleTool', () => {
  it('should deny tool execution when policy is "deny"', async () => {
    const tools = createMockToolRegistry();
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'deny', high: 'ask', critical: 'deny' },
    });
    const ctx = createTestContext(tools, { permissionPolicy });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('Permission denied');
    expect(resultEvent.result).toContain(tc.name);

    // Tool should NOT have been executed
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('should use tool-level policy over risk-level policy', async () => {
    const tools = createMockToolRegistry();
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'deny', high: 'ask', critical: 'deny' },
      toolPolicies: { 'test-tool': 'allow' },
    });
    const ctx = createTestContext(tools, { permissionPolicy });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should NOT be denied - tool-level policy overrides risk-level
    const denied = events.some(e => {
      if (e.event.type === 'tool.result') {
        return (e.event as AgentEvent & { type: 'tool.result' }).isError &&
          (e.event as AgentEvent & { type: 'tool.result' }).result.includes('Permission denied');
      }
      return false;
    });
    expect(denied).toBe(false);
  });

  it('should use risk-level policy when no tool-level policy exists', async () => {
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A test tool',
        parameters: {},
        execute: async () => 'tool result',
        riskLevel: 'critical',
      }),
    });
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'allow', high: 'allow', critical: 'deny' },
      toolPolicies: {},
    });
    const ctx = createTestContext(tools, { permissionPolicy });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('Permission denied');
  });

  it('should force "ask" when requiresApproval=true and enforceApprovalFlag=true', async () => {
    const permissionController = createMockPermissionController({
      ask: vi.fn().mockReturnValue(of('allow' as PermissionDecision)),
    });
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A test tool',
        parameters: {},
        execute: async () => 'tool result',
        requiresApproval: true,
      }),
    });
    const permissionPolicy = createMockPermissionPolicy({
      defaultPolicy: 'allow',
      enforceApprovalFlag: true,
    });
    const ctx = createTestContext(tools, { permissionPolicy, permissionController });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // permissionController.ask should have been called
    expect(permissionController.ask).toHaveBeenCalled();
  });

  it('should pass through when permissionPolicy is not configured', async () => {
    const tools = createMockToolRegistry();
    const ctx = createTestContext(tools);
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should get tool.execute + tool.result (not blocked)
    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(events.some(e => e.event.type === 'tool.result')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });
});

// ============================================================
// Tests: Permission Controller Flow
// ============================================================

describe('permissionController ask flow in executeSingleTool', () => {
  it('should execute tool when permission is "allow"', async () => {
    const tools = createMockToolRegistry();
    const permissionController = createMockPermissionController({
      ask: vi.fn().mockReturnValue(of('allow' as PermissionDecision)),
    });
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'ask', high: 'ask', critical: 'deny' },
    });
    const ctx = createTestContext(tools, { permissionPolicy, permissionController });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should get tool.execute + tool.result (tool was executed)
    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(events.some(e => e.event.type === 'tool.result')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });

  it('should deny tool when permission is "deny"', async () => {
    const tools = createMockToolRegistry();
    const permissionController = createMockPermissionController({
      ask: vi.fn().mockReturnValue(of('deny' as PermissionDecision)),
    });
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'ask', high: 'ask', critical: 'deny' },
    });
    const ctx = createTestContext(tools, { permissionPolicy, permissionController });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('Permission denied by user');

    // Tool should NOT have been executed
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('should cache auto-allow when permission is "allow_always"', async () => {
    const tools = createMockToolRegistry();
    const permissionController = createMockPermissionController({
      ask: vi.fn().mockReturnValue(of('allow_always' as PermissionDecision)),
      isAutoAllowed: vi.fn().mockReturnValue(false),
    });
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'ask', high: 'ask', critical: 'deny' },
    });
    const ctx = createTestContext(tools, { permissionPolicy, permissionController });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should have called isAutoAllowed to cache the decision
    expect(permissionController.isAutoAllowed).toHaveBeenCalledWith(tc.name);

    // Tool should have been executed
    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });

  it('should fall back to direct execution on ask error', async () => {
    const tools = createMockToolRegistry();
    const permissionController = createMockPermissionController({
      ask: vi.fn().mockReturnValue(new Observable(subscriber => {
        subscriber.error(new Error('Permission system unavailable'));
      })),
    });
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'ask', high: 'ask', critical: 'deny' },
    });
    const ctx = createTestContext(tools, { permissionPolicy, permissionController });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should fall back to direct execution (catchError path)
    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });
});

// ============================================================
// Tests: Sandbox Executor Routing
// ============================================================

describe('sandboxExecutor routing in executeSingleTool', () => {
  it('should route to sandbox when tool has sandboxRequired=true', async () => {
    const sandboxResult = {
      success: true,
      result: 'sandbox output',
      durationMs: 50,
    };
    const sandboxExecutor = createMockSandboxExecutor({
      execute: vi.fn().mockResolvedValue(sandboxResult),
    });
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A sandboxed tool',
        parameters: {},
        execute: async () => 'should not reach here',
        sandboxRequired: true,
      }),
    });
    const ctx = createTestContext(tools, { sandboxExecutor });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(false);
    expect(resultEvent.result).toBe('sandbox output');

    // Sandbox executor should have been called
    expect(sandboxExecutor.execute).toHaveBeenCalledWith(
      { toolName: tc.name, args: tc.args },
      { sessionId: 'test-session', timeoutMs: 30000, toolRegistry: tools }
    );

    // Direct tool execution should NOT have been called
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('should handle sandbox execution failure', async () => {
    const sandboxExecutor = createMockSandboxExecutor({
      execute: vi.fn().mockResolvedValue({
        success: false,
        error: { name: 'SandboxError', message: 'container crashed' },
        durationMs: 100,
      }),
    });
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A sandboxed tool',
        parameters: {},
        execute: async () => 'should not reach here',
        sandboxRequired: true,
      }),
    });
    const ctx = createTestContext(tools, { sandboxExecutor });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('Sandbox error');
    expect(resultEvent.result).toContain('container crashed');
  });

  it('should handle sandbox executor throwing an error', async () => {
    const sandboxExecutor = createMockSandboxExecutor({
      execute: vi.fn().mockRejectedValue(new Error('Docker not available')),
    });
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A sandboxed tool',
        parameters: {},
        execute: async () => 'should not reach here',
        sandboxRequired: true,
      }),
    });
    const ctx = createTestContext(tools, { sandboxExecutor });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('Sandbox execution failed');
    expect(resultEvent.result).toContain('Docker not available');
  });

  it('should use default tool execution when sandboxRequired is false', async () => {
    const sandboxExecutor = createMockSandboxExecutor();
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A normal tool',
        parameters: {},
        execute: async () => 'normal result',
        sandboxRequired: false,
      }),
    });
    const ctx = createTestContext(tools, { sandboxExecutor });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should use direct execution, not sandbox
    expect(sandboxExecutor.execute).not.toHaveBeenCalled();
    expect(tools.execute).toHaveBeenCalled();
  });

  it('should pass through when sandboxExecutor is not configured', async () => {
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A sandboxed tool',
        parameters: {},
        execute: async () => 'normal result',
        sandboxRequired: true,
      }),
    });
    const ctx = createTestContext(tools); // No sandboxExecutor
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should use direct execution when sandboxExecutor is not available
    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });
});

// ============================================================
// Tests: Security Guard Check
// ============================================================

describe('securityGuard check in executeSingleTool', () => {
  it('should block tool execution when security check fails', async () => {
    const tools = createMockToolRegistry();
    const securityGuard = createMockSecurityGuard({
      checkCommand: vi.fn().mockReturnValue({ allowed: false, reason: 'blocked command' }),
    });
    const ctx = createTestContext(tools, { securityGuard });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('Security violation');
    expect(resultEvent.result).toContain('blocked command');
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('should pass through when security check passes', async () => {
    const tools = createMockToolRegistry();
    const securityGuard = createMockSecurityGuard({
      checkCommand: vi.fn().mockReturnValue({ allowed: true }),
    });
    const ctx = createTestContext(tools, { securityGuard });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });

  it('should pass through when securityGuard throws', async () => {
    const tools = createMockToolRegistry();
    const securityGuard = createMockSecurityGuard({
      checkCommand: vi.fn().mockImplementation(() => { throw new Error('guard crash'); }),
    });
    const ctx = createTestContext(tools, { securityGuard });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should not crash — allow execution
    expect(events.some(e => e.event.type === 'tool.execute')).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });
});

// ============================================================
// Tests: executeToolDirectly
// ============================================================

describe('executeToolDirectly', () => {
  it('should execute tool and return execute + result events', async () => {
    const tools = createMockToolRegistry({
      execute: vi.fn().mockResolvedValue('direct result'),
    });
    const ctx = createTestContext(tools);
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeToolDirectly(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('tool.execute');
    expect(events[1]!.event.type).toBe('tool.result');
    const resultEvent = events[1]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.result).toBe('direct result');
    expect(resultEvent.isError).toBe(false);
  });

  it('should handle tool execution error', async () => {
    const tools = createMockToolRegistry({
      execute: vi.fn().mockRejectedValue(new Error('tool failed')),
    });
    const ctx = createTestContext(tools);
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeToolDirectly(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('tool.execute');
    expect(events[1]!.event.type).toBe('tool.result');
    const resultEvent = events[1]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.isError).toBe(true);
    expect(resultEvent.result).toContain('tool failed');
  });

  it('should emit hitl.ask when result starts with HITL_REQUIRED:', async () => {
    const tools = createMockToolRegistry({
      execute: vi.fn().mockResolvedValue('HITL_REQUIRED: Do you want to proceed?'),
    });
    const hitl = {
      ask: vi.fn().mockReturnValue(of('yes')),
      onAsk: vi.fn().mockReturnValue(of({})),
      answer: vi.fn(),
    };
    const ctx = createTestContext(tools, { hitl });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeToolDirectly(deps, tc, state).pipe(toArray()));

    expect(events).toHaveLength(2);
    expect(events[0]!.event.type).toBe('tool.execute');
    expect(events[1]!.event.type).toBe('hitl.ask');
    const askEvent = events[1]!.event as AgentEvent & { type: 'hitl.ask' };
    expect(askEvent.question).toBe('Do you want to proceed?');
  });
});

// ============================================================
// Tests: Guard Ordering (permission before security before sandbox)
// ============================================================

describe('guard ordering in executeSingleTool', () => {
  it('should check permission policy before security guard', async () => {
    const tools = createMockToolRegistry();
    const securityGuard = createMockSecurityGuard();
    const permissionPolicy = createMockPermissionPolicy({
      riskPolicies: { low: 'allow', medium: 'deny', high: 'ask', critical: 'deny' },
    });
    const ctx = createTestContext(tools, { permissionPolicy, securityGuard });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should be denied by permission policy, not security guard
    expect(events).toHaveLength(1);
    expect(events[0]!.event.type).toBe('tool.result');
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.result).toContain('Permission denied');
    expect(resultEvent.result).not.toContain('Security violation');

    // Security guard should NOT have been called
    expect(securityGuard.checkCommand).not.toHaveBeenCalled();
  });

  it('should check security guard before sandbox executor', async () => {
    const tools = createMockToolRegistry({
      get: () => ({
        name: 'test-tool',
        description: 'A sandboxed tool',
        parameters: {},
        execute: async () => 'should not reach here',
        sandboxRequired: true,
      }),
    });
    const securityGuard = createMockSecurityGuard({
      checkCommand: vi.fn().mockReturnValue({ allowed: false, reason: 'blocked' }),
    });
    const sandboxExecutor = createMockSandboxExecutor();
    const ctx = createTestContext(tools, { securityGuard, sandboxExecutor });
    const deps = createTestDeps(ctx);
    const state = createTestState();
    const tc = createTestToolCall();

    const events = await firstValueFrom(executeSingleTool(deps, tc, state).pipe(toArray()));

    // Should be blocked by security guard, not sandbox
    expect(events).toHaveLength(1);
    const resultEvent = events[0]!.event as AgentEvent & { type: 'tool.result' };
    expect(resultEvent.result).toContain('Security violation');

    // Sandbox should NOT have been called
    expect(sandboxExecutor.execute).not.toHaveBeenCalled();
  });
});
