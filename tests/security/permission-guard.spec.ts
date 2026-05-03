/**
 * Permission Guard Tests
 *
 * Tests for evaluatePermissionGuard, event creation helpers,
 * and handlePermissionAsk with DefaultPermissionController.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  evaluatePermissionGuard,
  createPermissionDeniedEvents,
  createPermissionPromptEvent,
  createPermissionDecisionEvent,
  handlePermissionAsk,
} from '../../src/security/permission/permission-guard.js';
import { DefaultPermissionController } from '../../src/security/permission/permission-controller.js';
import { DefaultApprovalChannel } from '../../src/core/approval-channel.js';
import { DEFAULT_PERMISSION_POLICY } from '../../src/security/permission/permission-policy.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';
import type { PermissionController, PermissionPrompt } from '../../src/security/permission/permission-controller.js';
import type { AgentEvent } from '../../src/core/events.js';

// ============================================================
// Helpers
// ============================================================

function createMockTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {},
    execute: async () => 'done',
    ...overrides,
  };
}

function createMockToolCall(): { id: string; name: string; args: Record<string, unknown> } {
  return { id: 'tc-1', name: 'test_tool', args: {} };
}

function createMockOnAllowResult(overrides: Partial<{ event: AgentEvent; state: unknown }> = {}): {
  event: AgentEvent;
  state: unknown;
} {
  return {
    event: {
      type: 'tool.result',
      timestamp: Date.now(),
      sessionId: 'ses-default',
      toolCallId: 'tc-1',
      result: 'success',
      duration: 0,
    } as AgentEvent,
    state: { done: true },
    ...overrides,
  };
}

function createThrowingController(): PermissionController {
  return {
    ask: async () => {
      throw new Error('Controller error');
    },
    onAsk: (_listener: (prompt: PermissionPrompt) => void) => () => {},
    answer: (_promptId: string, _decision: 'allow' | 'deny' | 'allow_always') => {},
    isAutoAllowed: (_permission: string) => false,
    cancel: (_promptId: string) => {},
  };
}

// ============================================================
// Tests
// ============================================================

describe('evaluatePermissionGuard', () => {
  it('should return deny for critical-risk tool with default policy', () => {
    const tool = createMockTool({ riskLevel: 'critical', name: 'destroy_database' });
    const result = evaluatePermissionGuard(tool, DEFAULT_PERMISSION_POLICY);
    expect(result).toBe('deny');
  });

  it('should return allow for low-risk tool with default policy', () => {
    const tool = createMockTool({ riskLevel: 'low', name: 'read_file' });
    const result = evaluatePermissionGuard(tool, DEFAULT_PERMISSION_POLICY);
    expect(result).toBe('allow');
  });

  it('should return ask for high-risk tool with default policy', () => {
    const tool = createMockTool({ riskLevel: 'high', name: 'write_file' });
    const result = evaluatePermissionGuard(tool, DEFAULT_PERMISSION_POLICY);
    expect(result).toBe('ask');
  });

  it('should return ask when requiresApproval is true and enforceApprovalFlag is true', () => {
    const tool = createMockTool({ riskLevel: 'low', name: 'sensitive_op', requiresApproval: true });
    const result = evaluatePermissionGuard(tool, DEFAULT_PERMISSION_POLICY);
    expect(result).toBe('ask');
  });

  it('should respect tool-level policy override', () => {
    const policy = {
      ...DEFAULT_PERMISSION_POLICY,
      toolPolicies: { 'super_safe_tool': 'allow' as const },
    };
    const tool = createMockTool({ riskLevel: 'critical', name: 'super_safe_tool' });
    const result = evaluatePermissionGuard(tool, policy);
    expect(result).toBe('allow');
  });
});

describe('createPermissionDeniedEvents', () => {
  it('should produce [agent.error, done] events', () => {
    const events = createPermissionDeniedEvents('danger_tool', 'ses-1', 5, 'Blocked by policy');
    expect(events).toHaveLength(2);

    const [errorEvent, doneEvent] = events as [AgentEvent, AgentEvent];
    expect(errorEvent!.type).toBe('agent.error');
    expect(errorEvent!.sessionId).toBe('ses-1');
    expect((errorEvent as { step?: number }).step).toBe(5);

    expect(doneEvent!.type).toBe('done');
    expect(doneEvent!.sessionId).toBe('ses-1');
    expect((doneEvent as { reason: string }).reason).toBe('error');
  });

  it('should include tool name in error message when reason is empty', () => {
    const events = createPermissionDeniedEvents('danger_tool', 'ses-1', 1, '');
    const errorEvent = events[0]!;
    const err = (errorEvent as { error: { name: string; message: string } }).error;
    expect(err.name).toBe('PermissionDeniedError');
    expect(err.message).toContain('danger_tool');
  });
});

describe('createPermissionPromptEvent', () => {
  it('should produce a valid permission.prompt event', () => {
    const event = createPermissionPromptEvent('pid-1', 'tool:write', 'ses-1', { key: 'val' });
    expect(event.type).toBe('permission.prompt');
    expect((event as { promptId: string }).promptId).toBe('pid-1');
    expect((event as { permission: string }).permission).toBe('tool:write');
    expect(event.sessionId).toBe('ses-1');
    expect(typeof event.timestamp).toBe('number');
  });

  it('should include context when provided', () => {
    const event = createPermissionPromptEvent('pid-2', 'tool:read', 'ses-2', {
      riskLevel: 'high',
      approvalMessage: 'Are you sure?',
    });
    const ctx = (event as { context?: Record<string, unknown> }).context;
    expect(ctx).toBeDefined();
    expect(ctx!.riskLevel).toBe('high');
    expect(ctx!.approvalMessage).toBe('Are you sure?');
  });

  it('should omit context when not provided', () => {
    const event = createPermissionPromptEvent('pid-3', 'tool:status', 'ses-3');
    // exactOptionalPropertyTypes: context should not be set to undefined
    const evt = event as { context?: Record<string, unknown> };
    expect(evt.context).toBeUndefined();
  });
});

describe('createPermissionDecisionEvent', () => {
  it('should produce a valid permission.decision event with allow', () => {
    const event = createPermissionDecisionEvent('pid-1', 'allow', 'ses-1');
    expect(event.type).toBe('permission.decision');
    expect((event as { promptId: string }).promptId).toBe('pid-1');
    expect((event as { decision: string }).decision).toBe('allow');
    expect(event.sessionId).toBe('ses-1');
    expect(typeof event.timestamp).toBe('number');
  });

  it('should produce a valid permission.decision event with deny', () => {
    const event = createPermissionDecisionEvent('pid-2', 'deny', 'ses-2');
    expect(event.type).toBe('permission.decision');
    expect((event as { decision: string }).decision).toBe('deny');
  });

  it('should produce a valid permission.decision event with allow_always', () => {
    const event = createPermissionDecisionEvent('pid-3', 'allow_always', 'ses-3');
    expect(event.type).toBe('permission.decision');
    expect((event as { decision: string }).decision).toBe('allow_always');
  });
});

describe('handlePermissionAsk', () => {
  let channel: DefaultApprovalChannel;
  let controller: DefaultPermissionController;

  beforeEach(() => {
    channel = new DefaultApprovalChannel();
    controller = new DefaultPermissionController(channel);
  });

  afterEach(() => {
    channel.destroy();
  });

  it('should execute tool via onAllow when controller returns allow', async () => {
    const tool = createMockTool({ riskLevel: 'high', name: 'write_file' });
    const toolCall = createMockToolCall();
    const onAllowResult = createMockOnAllowResult();
    const onAllow = vi.fn(async () => onAllowResult);

    let capturedPromptId = '';
    channel.onAsk((prompt) => {
      capturedPromptId = prompt.promptId;
    });

    const resultPromise = handlePermissionAsk(
      toolCall,
      tool,
      'ses-1',
      1,
      controller,
      onAllow,
    );

    // Yield to allow handlePermissionAsk's internal await (safeClassify)
    // to complete and reach permissionController.ask() which fires channel onAsk
    await new Promise((r) => setTimeout(r, 0));

    // Answer to resolve the permission prompt
    controller.answer(capturedPromptId, 'allow');
    const results = await resultPromise;

    expect(results).toHaveLength(2);
    expect(results[0]!.event.type).toBe('permission.decision');
    expect((results[0]!.event as { decision: string }).decision).toBe('allow');
    expect(results[1]!.event.type).toBe('tool.result');
    expect(onAllow).toHaveBeenCalledOnce();
  });

  it('should return denial events when controller returns deny', async () => {
    const tool = createMockTool({
      riskLevel: 'high',
      name: 'write_file',
      approvalMessage: 'Write ops need review',
    });
    const toolCall = createMockToolCall();
    const onAllow = vi.fn(async () => createMockOnAllowResult());

    let capturedPromptId = '';
    channel.onAsk((prompt) => {
      capturedPromptId = prompt.promptId;
    });

    const resultPromise = handlePermissionAsk(
      toolCall,
      tool,
      'ses-1',
      1,
      controller,
      onAllow,
    );

    // Yield to allow handlePermissionAsk's internal await to reach channel.ask()
    await new Promise((r) => setTimeout(r, 0));

    controller.answer(capturedPromptId, 'deny');
    const results = await resultPromise;

    // Expect [decision, agent.error, done] = 3 entries
    expect(results).toHaveLength(3);
    expect(results[0]!.event.type).toBe('permission.decision');
    expect((results[0]!.event as { decision: string }).decision).toBe('deny');
    expect(results[1]!.event.type).toBe('agent.error');
    expect(results[2]!.event.type).toBe('done');
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('should return [agent.error, done] when controller throws', async () => {
    const tool = createMockTool({ riskLevel: 'high', name: 'bad_tool' });
    const toolCall = createMockToolCall();
    const onAllow = vi.fn(async () => createMockOnAllowResult());
    const throwingController = createThrowingController();

    const results = await handlePermissionAsk(
      toolCall,
      tool,
      'ses-1',
      1,
      throwingController,
      onAllow,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.event.type).toBe('agent.error');
    expect(results[1]!.event.type).toBe('done');
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('should pass tool arguments to permission controller', async () => {
    const tool = createMockTool({ riskLevel: 'high', name: 'write_file' });
    const toolCall = {
      id: 'tc-1',
      name: 'write_file',
      args: { path: '/tmp/test.txt', content: 'hello' },
    };
    const onAllow = vi.fn(async () => createMockOnAllowResult());

    let capturedPromptId = '';
    channel.onAsk((prompt) => {
      capturedPromptId = prompt.promptId;
    });

    const resultPromise = handlePermissionAsk(
      toolCall,
      tool,
      'ses-1',
      1,
      controller,
      onAllow,
    );

    // Yield to allow handlePermissionAsk's internal await to reach channel.ask()
    await new Promise((r) => setTimeout(r, 0));

    controller.answer(capturedPromptId, 'allow');
    const results = await resultPromise;

    expect(results).toHaveLength(2);
    expect(onAllow).toHaveBeenCalledOnce();
  });
});
