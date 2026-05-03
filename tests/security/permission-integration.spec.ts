/**
 * Permission Integration Tests
 *
 * Tests the full ApprovalChannel → PermissionController → handlePermissionAsk pipeline.
 * Verifies end-to-end HITL flow: ask → answer → decision → tool execution/blocking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handlePermissionAsk } from '../../src/security/permission/permission-guard.js';
import { DefaultPermissionController } from '../../src/security/permission/permission-controller.js';
import { DefaultApprovalChannel } from '../../src/core/approval-channel.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';
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
    riskLevel: 'high',
    ...overrides,
  };
}

function createMockToolCall(name: string = 'test_tool'): {
  id: string;
  name: string;
  args: Record<string, unknown>;
} {
  return { id: `tc-${Date.now()}`, name, args: {} };
}

function createMockOnAllowResult(): { event: AgentEvent; state: unknown } {
  return {
    event: {
      type: 'tool.result',
      timestamp: Date.now(),
      sessionId: 'ses-int',
      toolCallId: 'tc-1',
      result: 'success',
      duration: 0,
    } as AgentEvent,
    state: { executed: true },
  };
}

// ============================================================
// Tests
// ============================================================

describe('ApprovalChannel → PermissionController → handlePermissionAsk pipeline', () => {
  let channel: DefaultApprovalChannel;
  let controller: DefaultPermissionController;

  beforeEach(() => {
    channel = new DefaultApprovalChannel();
    controller = new DefaultPermissionController(channel);
  });

  afterEach(() => {
    channel.destroy();
  });

  it('should execute tool when pipeline returns allow', async () => {
    const tool = createMockTool({ name: 'restart_service', riskLevel: 'high' });
    const toolCall = createMockToolCall('restart_service');
    const onAllow = vi.fn(async () => createMockOnAllowResult());

    let capturedPromptId = '';
    channel.onAsk((prompt) => {
      capturedPromptId = prompt.promptId;
    });

    // Start the permission ask — it will block waiting for user answer
    const resultPromise = handlePermissionAsk(
      toolCall,
      tool,
      'ses-int-1',
      1,
      controller,
      onAllow,
    );

    // Yield to allow handlePermissionAsk's internal await to reach channel.ask()
    await new Promise((r) => setTimeout(r, 0));

    // Approve the request through the channel (simulating UI answer)
    controller.answer(capturedPromptId, 'allow');

    const results = await resultPromise;

    // Should have 2 entries: decision event + tool result
    expect(results).toHaveLength(2);

    // First: permission.decision with 'allow'
    const [decisionEntry, toolEntry] = results as [typeof results[0], typeof results[1]];
    expect(decisionEntry!.event.type).toBe('permission.decision');
    expect((decisionEntry!.event as { decision: string }).decision).toBe('allow');

    // Second: tool.result from onAllow
    expect(toolEntry!.event.type).toBe('tool.result');
    expect(onAllow).toHaveBeenCalledOnce();
  });

  it('should block tool execution when pipeline returns deny', async () => {
    const tool = createMockTool({
      name: 'delete_user',
      riskLevel: 'critical',
      approvalMessage: 'Deleting users is irreversible',
    });
    const toolCall = createMockToolCall('delete_user');
    const onAllow = vi.fn(async () => createMockOnAllowResult());

    let capturedPromptId = '';
    channel.onAsk((prompt) => {
      capturedPromptId = prompt.promptId;
    });

    const resultPromise = handlePermissionAsk(
      toolCall,
      tool,
      'ses-int-2',
      1,
      controller,
      onAllow,
    );

    // Yield to allow handlePermissionAsk's internal await to reach channel.ask()
    await new Promise((r) => setTimeout(r, 0));

    // Deny the request
    controller.answer(capturedPromptId, 'deny');

    const results = await resultPromise;

    // Should have 3 entries: decision + agent.error + done
    expect(results).toHaveLength(3);

    const [decisionEntry, errorEntry, doneEntry] = results as [
      typeof results[0],
      typeof results[1],
      typeof results[2],
    ];

    expect(decisionEntry!.event.type).toBe('permission.decision');
    expect((decisionEntry!.event as { decision: string }).decision).toBe('deny');

    expect(errorEntry!.event.type).toBe('agent.error');

    expect(doneEntry!.event.type).toBe('done');
    expect((doneEntry!.event as { reason: string }).reason).toBe('error');

    // Tool must NOT have been called
    expect(onAllow).not.toHaveBeenCalled();
  });

  it('should auto-allow subsequent calls after allow_always', async () => {
    const tool = createMockTool({ name: 'verify_identity', riskLevel: 'high' });
    const toolCall1 = createMockToolCall('verify_identity');
    const onAllow1 = vi.fn(async () => createMockOnAllowResult());

    let capturedPromptId = '';
    let promptCount = 0;
    channel.onAsk((prompt) => {
      capturedPromptId = prompt.promptId;
      promptCount++;
    });

    // ── First call: answer with allow_always ──
    const resultPromise1 = handlePermissionAsk(
      toolCall1,
      tool,
      'ses-int-3',
      1,
      controller,
      onAllow1,
    );

    // Yield to allow handlePermissionAsk's internal await to reach channel.ask()
    await new Promise((r) => setTimeout(r, 0));

    controller.answer(capturedPromptId, 'allow_always');
    const results1 = await resultPromise1;

    expect(results1).toHaveLength(2);
    expect(onAllow1).toHaveBeenCalledOnce();
    expect(controller.isAutoAllowed('verify_identity')).toBe(true);

    // ── Second call: should auto-allow without prompting ──
    const toolCall2 = createMockToolCall('verify_identity');
    const onAllow2 = vi.fn(async () => createMockOnAllowResult());

    const results2 = await handlePermissionAsk(
      toolCall2,
      tool,
      'ses-int-3',
      2,
      controller,
      onAllow2,
    );

    // Should still have 2 entries (decision + tool result), no extra prompt
    expect(results2).toHaveLength(2);
    expect(onAllow2).toHaveBeenCalledOnce();

    // Only 1 prompt should have been emitted (from first call)
    expect(promptCount).toBe(1);

    const decisionEvent2 = results2[0]!.event;
    expect(decisionEvent2.type).toBe('permission.decision');
    expect((decisionEvent2 as { decision: string }).decision).toBe('allow');
  });
});
