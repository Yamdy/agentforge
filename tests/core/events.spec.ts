/**
 * Unit tests for src/core/events.ts
 *
 * Tests Zod schemas for all event types, type guards, and helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentEventTypeSchema,
  type AgentEventType,
  MessageRoleSchema,
  type MessageRole,
  MessageSchema,
  type Message,
  ToolCallSchema,
  type ToolCall,
  FinishReasonSchema,
  type FinishReason,
  SerializedErrorSchema,
  type SerializedError,
  AgentEventSchema,
  type AgentEvent,
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isHITLEvent,
  isAgentLifecycleEvent,
  isTerminalEvent,
  isSubagentEvent,
  isMCPEvent,
  isWorkflowEvent,
  isCompactionEvent,
  isPermissionEvent,
  serializeError,
  generateId,
} from '../../src/core/events.js';

// ============================================================
// Event Type Enumeration
// ============================================================

describe('AgentEventTypeSchema', () => {
  it('should have all event types (slimmed per §7.1/7.2)', () => {
    const types = AgentEventTypeSchema.options;
    expect(types.length).toBeGreaterThan(24);
  });

  it('should validate core agent loop events', () => {
    const coreEvents = [
      'agent.start',
      'agent.step',
      'agent.complete',
      'agent.error',
      'llm.request',
      'llm.stream.text',
      'llm.response',
      'tool.call',
      'tool.execute',
      'tool.result',
      'tool.error',
      'hitl.ask',
      'hitl.answer',
      'checkpoint',
      'cancel',
      'done',
    ];

    for (const event of coreEvents) {
      expect(AgentEventTypeSchema.safeParse(event).success).toBe(true);
    }
  });

  it('should validate subsystem lifecycle events', () => {
    const subsystemEvents = [
      'subagent.start',
      'subagent.step',
      'subagent.complete',
      'subagent.error',
      'mcp.connecting',
      'mcp.connected',
      'mcp.disconnected',
      'workflow.start',
      'workflow.complete',
      'workflow.error',
    ];

    for (const event of subsystemEvents) {
      expect(AgentEventTypeSchema.safeParse(event).success).toBe(true);
    }
  });

  it('should validate cross-cutting events', () => {
    const crossCuttingEvents = ['cancel', 'decision.trace'];

    for (const event of crossCuttingEvents) {
      expect(AgentEventTypeSchema.safeParse(event).success).toBe(true);
    }
  });

  it('should reject invalid event types', () => {
    expect(AgentEventTypeSchema.safeParse('invalid.event').success).toBe(false);
    expect(AgentEventTypeSchema.safeParse('agent').success).toBe(false);
    expect(AgentEventTypeSchema.safeParse('').success).toBe(false);
  });
});

// ============================================================
// Common Schemas
// ============================================================

describe('MessageRoleSchema', () => {
  it('should validate valid roles', () => {
    expect(MessageRoleSchema.safeParse('system').success).toBe(true);
    expect(MessageRoleSchema.safeParse('user').success).toBe(true);
    expect(MessageRoleSchema.safeParse('assistant').success).toBe(true);
    expect(MessageRoleSchema.safeParse('tool').success).toBe(true);
  });

  it('should reject invalid roles', () => {
    expect(MessageRoleSchema.safeParse('admin').success).toBe(false);
    expect(MessageRoleSchema.safeParse('').success).toBe(false);
  });
});

describe('MessageSchema', () => {
  it('should validate basic message', () => {
    const message = {
      role: 'user' as const,
      content: 'Hello, world!',
    };
    expect(MessageSchema.safeParse(message).success).toBe(true);
  });

  it('should validate tool message with toolCallId', () => {
    const message = {
      role: 'tool' as const,
      content: '{"result": "ok"}',
      toolCallId: 'tc-123',
    };
    expect(MessageSchema.safeParse(message).success).toBe(true);
  });

  it('should validate message with name', () => {
    const message = {
      role: 'tool' as const,
      content: 'result',
      name: 'weather_tool',
    };
    expect(MessageSchema.safeParse(message).success).toBe(true);
  });

  it('should reject message without required fields', () => {
    expect(MessageSchema.safeParse({ role: 'user' }).success).toBe(false);
    expect(MessageSchema.safeParse({ content: 'test' }).success).toBe(false);
  });
});

describe('ToolCallSchema', () => {
  it('should validate tool call', () => {
    const toolCall = {
      id: 'tc-123',
      name: 'weather',
      args: { city: 'Beijing' },
    };
    expect(ToolCallSchema.safeParse(toolCall).success).toBe(true);
  });

  it('should validate tool call with empty args', () => {
    const toolCall = {
      id: 'tc-456',
      name: 'ping',
      args: {},
    };
    expect(ToolCallSchema.safeParse(toolCall).success).toBe(true);
  });

  it('should reject tool call without required fields', () => {
    expect(ToolCallSchema.safeParse({ id: 'tc-1' }).success).toBe(false);
    expect(ToolCallSchema.safeParse({ name: 'weather' }).success).toBe(false);
  });
});

describe('FinishReasonSchema', () => {
  it('should validate valid finish reasons', () => {
    const reasons: FinishReason[] = ['stop', 'tool_calls', 'length', 'error', 'cancelled'];
    for (const reason of reasons) {
      expect(FinishReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it('should reject invalid finish reasons', () => {
    expect(FinishReasonSchema.safeParse('timeout').success).toBe(false);
    expect(FinishReasonSchema.safeParse('').success).toBe(false);
  });
});

describe('SerializedErrorSchema', () => {
  it('should validate serialized error', () => {
    const error: SerializedError = {
      name: 'TypeError',
      message: 'Cannot read property',
    };
    expect(SerializedErrorSchema.safeParse(error).success).toBe(true);
  });

  it('should validate serialized error with stack', () => {
    const error: SerializedError = {
      name: 'Error',
      message: 'Something went wrong',
      stack: 'Error: Something went wrong\n    at test.js:1',
    };
    expect(SerializedErrorSchema.safeParse(error).success).toBe(true);
  });

  it('should reject error without required fields', () => {
    expect(SerializedErrorSchema.safeParse({ name: 'Error' }).success).toBe(false);
    expect(SerializedErrorSchema.safeParse({ message: 'test' }).success).toBe(false);
  });
});

// ============================================================
// Agent Event Schema
// ============================================================

describe('AgentEventSchema', () => {
  // ----- agent.* -----
  describe('agent.start', () => {
    it('should validate agent.start event', () => {
      const event = {
        type: 'agent.start' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        input: 'Hello',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('agent.step', () => {
    it('should validate agent.step event', () => {
      const event = {
        type: 'agent.step' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        step: 1,
        maxSteps: 10,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('agent.complete', () => {
    it('should validate agent.complete event', () => {
      const event = {
        type: 'agent.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        output: 'Hello! How can I help you?',
        steps: 1,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate agent.complete with optional tokens', () => {
      const event = {
        type: 'agent.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        output: 'Done',
        steps: 3,
        tokens: { input: 100, output: 50 },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('agent.error', () => {
    it('should validate agent.error event', () => {
      const event = {
        type: 'agent.error' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        error: { name: 'Error', message: 'Something went wrong' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate agent.error with optional step', () => {
      const event = {
        type: 'agent.error' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        error: { name: 'Error', message: 'Failed' },
        step: 5,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  // ----- llm.* -----
  describe('llm.response', () => {
    it('should validate llm.response without tool calls', () => {
      const event = {
        type: 'llm.response' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        content: 'Hello!',
        finishReason: 'stop' as const,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate llm.response with tool calls', () => {
      const event = {
        type: 'llm.response' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'weather', args: { city: 'Beijing' } }],
        finishReason: 'tool_calls' as const,
        usage: { promptTokens: 100, completionTokens: 20 },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('llm.output.invalid', () => {
    it('should validate llm.output.invalid event', () => {
      const event = {
        type: 'llm.output.invalid' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        reason: 'Invalid tool name',
        originalResponse: { content: '' },
        attempt: 1,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  // ----- tool.* -----
  describe('tool.result', () => {
    it('should validate tool.result event', () => {
      const event = {
        type: 'tool.result' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        toolCallId: 'tc-1',
        toolName: 'weather',
        result: '{"temp": 25}',
        isError: false,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate tool.result with error flag', () => {
      const event = {
        type: 'tool.result' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        toolCallId: 'tc-1',
        toolName: 'weather',
        result: '',
        isError: true,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('tool.batch events', () => {
    it('should validate tool.batch.start event', () => {
      const event = {
        type: 'tool.batch.start' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        batchId: 'batch-1',
        totalCalls: 3,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate tool.batch event', () => {
      const event = {
        type: 'tool.batch' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        batchId: 'batch-1',
        calls: [
          { toolCallId: 'tc-1', toolName: 'weather', args: {} },
          { toolCallId: 'tc-2', toolName: 'calculator', args: {} },
        ],
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate tool.batch.complete event', () => {
      const event = {
        type: 'tool.batch.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        batchId: 'batch-1',
        totalCalls: 3,
        successCount: 2,
        errorCount: 1,
        durationMs: 150,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  // ----- hitl.* -----
  describe('hitl events', () => {
    it('should validate hitl.ask event', () => {
      const event = {
        type: 'hitl.ask' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        askId: 'ask-1',
        question: 'Do you want to proceed?',
        toolCallId: 'tc-1',
        toolName: 'ask_permission',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate hitl.ask with options', () => {
      const event = {
        type: 'hitl.ask' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        askId: 'ask-1',
        question: 'Choose an option',
        toolCallId: 'tc-1',
        toolName: 'ask_permission',
        options: ['Yes', 'No', 'Cancel'],
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate hitl.answer event', () => {
      const event = {
        type: 'hitl.answer' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        askId: 'ask-1',
        answer: 'Yes',
        toolCallId: 'tc-1',
        toolName: 'ask_permission',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  // ----- control events -----
  describe('control events', () => {
    it('should validate done event', () => {
      const event = {
        type: 'done' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        reason: 'stop' as const,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate cancel event', () => {
      const event = {
        type: 'cancel' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        reason: 'User requested',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate checkpoint event', () => {
      const event = {
        type: 'checkpoint' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        checkpointId: 'cp-1',
        position: 'after_llm' as const,
        state: { step: 1 },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  // ----- subsystem events -----
  describe('subagent events', () => {
    it('should validate subagent.start event', () => {
      const event = {
        type: 'subagent.start' as const,
        timestamp: Date.now(),
        sessionId: 'sub-session-1',
        parentSessionId: 'session-123',
        subagentName: 'researcher',
        input: 'Search for X',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate subagent.step event', () => {
      const event = {
        type: 'subagent.step' as const,
        timestamp: Date.now(),
        sessionId: 'sub-session-1',
        step: 2,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate subagent.complete event', () => {
      const event = {
        type: 'subagent.complete' as const,
        timestamp: Date.now(),
        sessionId: 'sub-session-1',
        output: 'Found results',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate subagent.error event', () => {
      const event = {
        type: 'subagent.error' as const,
        timestamp: Date.now(),
        sessionId: 'sub-session-1',
        error: { name: 'TimeoutError', message: 'Subagent timed out' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('mcp events', () => {
    it('should validate mcp.connecting event', () => {
      const event = {
        type: 'mcp.connecting' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate mcp.connected event', () => {
      const event = {
        type: 'mcp.connected' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
        tools: ['read_file', 'write_file'],
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate mcp.connected event without tools', () => {
      const event = {
        type: 'mcp.connected' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate mcp.disconnected event', () => {
      const event = {
        type: 'mcp.disconnected' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
        reason: 'Connection lost',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate mcp.tools_changed event', () => {
      const event = {
        type: 'mcp.tools_changed' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
        added: ['new_tool'],
        removed: ['old_tool'],
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate mcp.error event', () => {
      const event = {
        type: 'mcp.error' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
        error: { name: 'ConnectionError', message: 'Failed to connect' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('workflow events', () => {
    it('should validate workflow.start event', () => {
      const event = {
        type: 'workflow.start' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        workflowName: 'Data Processing',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.step.start event', () => {
      const event = {
        type: 'workflow.step.start' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        stepId: 'step-1',
        stepName: 'Extract Data',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.step.end event', () => {
      const event = {
        type: 'workflow.step.end' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        stepId: 'step-1',
        result: 'success' as const,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.suspend event', () => {
      const event = {
        type: 'workflow.suspend' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        reason: 'Waiting for approval',
        waitingFor: 'user_confirm',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.resume event', () => {
      const event = {
        type: 'workflow.resume' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        resumeFrom: 'step-2',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.complete event', () => {
      const event = {
        type: 'workflow.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        result: { status: 'success', items: 10 },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.error event', () => {
      const event = {
        type: 'workflow.error' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        error: { name: 'WorkflowError', message: 'Step failed' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate workflow.error event with stepId', () => {
      const event = {
        type: 'workflow.error' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        error: { name: 'WorkflowError', message: 'Step failed' },
        stepId: 'step-3',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('compaction events', () => {
    it('should validate compaction.start event', () => {
      const event = {
        type: 'compaction.start' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        strategy: 'truncate-oldest' as const,
        tokensBefore: 10000,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate compaction.complete event', () => {
      const event = {
        type: 'compaction.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        tokensAfter: 5000,
        removedMessages: 10,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate compaction.complete event with summarizedMessages', () => {
      const event = {
        type: 'compaction.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        tokensAfter: 5000,
        removedMessages: 5,
        summarizedMessages: 10,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('permission events', () => {
    it('should validate permission.prompt event', () => {
      const event = {
        type: 'permission.prompt' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        promptId: 'perm-1',
        permission: 'file_write',
        context: { path: '/data/output.txt' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate permission.decision event', () => {
      const event = {
        type: 'permission.decision' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        promptId: 'perm-1',
        decision: 'allow' as const,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });

  describe('context.updated event', () => {
    it('should validate context.updated event', () => {
      const event = {
        type: 'context.updated' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        source: 'skill_loaded' as const,
        changes: {
          toolsAdded: ['new_tool'],
          skillsLoaded: ['skill-1'],
        },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });
  });
});

// ============================================================
// Type Guards
// ============================================================

describe('Type Guards', () => {
  const baseEvent = {
    timestamp: Date.now(),
    sessionId: 'session-123',
  };

  describe('isAgentEvent', () => {
    it('should return true for valid events', () => {
      const event = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isAgentEvent(event)).toBe(true);
    });

    it('should return false for invalid events', () => {
      expect(isAgentEvent({})).toBe(false);
      expect(isAgentEvent({ type: 'invalid' })).toBe(false);
    });
  });

  describe('isLLMEvent', () => {
    it('should return true for LLM events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'llm.response',
        content: 'test',
        finishReason: 'stop',
      };
      expect(isLLMEvent(event)).toBe(true);
    });

    it('should return false for non-LLM events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isLLMEvent(event)).toBe(false);
    });
  });

  describe('isToolEvent', () => {
    it('should return true for tool events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'tool.result',
        toolCallId: 'tc-1',
        toolName: 'test',
        result: 'ok',
        isError: false,
      };
      expect(isToolEvent(event)).toBe(true);
    });

    it('should return false for non-tool events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isToolEvent(event)).toBe(false);
    });
  });

  describe('isHITLEvent', () => {
    it('should return true for HITL events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'hitl.ask',
        askId: 'ask-1',
        question: 'test?',
      };
      expect(isHITLEvent(event)).toBe(true);
    });

    it('should return false for non-HITL events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isHITLEvent(event)).toBe(false);
    });
  });

  describe('isAgentLifecycleEvent', () => {
    it('should return true for agent lifecycle events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'agent.start',
        input: 'test',
        agentName: 'test',
        model: { provider: 'test', model: 'test' },
      };
      expect(isAgentLifecycleEvent(event)).toBe(true);
    });

    it('should return false for non-agent lifecycle events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isAgentLifecycleEvent(event)).toBe(false);
    });
  });

  describe('isTerminalEvent', () => {
    it('should return true for terminal events', () => {
      const doneEvent: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      const errorEvent: AgentEvent = {
        ...baseEvent,
        type: 'agent.error',
        error: { name: 'Error', message: 'test' },
      };
      const cancelEvent: AgentEvent = { ...baseEvent, type: 'cancel' };

      expect(isTerminalEvent(doneEvent)).toBe(true);
      expect(isTerminalEvent(errorEvent)).toBe(true);
      expect(isTerminalEvent(cancelEvent)).toBe(true);
    });

    it('should return false for non-terminal events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'llm.response',
        content: 'test',
        finishReason: 'stop',
      };
      expect(isTerminalEvent(event)).toBe(false);
    });
  });

  describe('isSubagentEvent', () => {
    it('should return true for subagent events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'subagent.start',
        parentSessionId: 'parent-1',
        subagentName: 'researcher',
        input: 'Search',
      };
      expect(isSubagentEvent(event)).toBe(true);
    });

    it('should return false for non-subagent events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isSubagentEvent(event)).toBe(false);
    });
  });

  describe('isMCPEvent', () => {
    it('should return true for MCP events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'mcp.connected',
        serverName: 'filesystem',
      };
      expect(isMCPEvent(event)).toBe(true);
    });

    it('should return true for mcp.error events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'mcp.error',
        serverName: 'filesystem',
        error: { name: 'Error', message: 'test' },
      };
      expect(isMCPEvent(event)).toBe(true);
    });

    it('should return false for non-MCP events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isMCPEvent(event)).toBe(false);
    });
  });

  describe('isWorkflowEvent', () => {
    it('should return true for workflow events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'workflow.start',
        workflowId: 'wf-1',
        workflowName: 'Test',
      };
      expect(isWorkflowEvent(event)).toBe(true);
    });

    it('should return true for workflow.error events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'workflow.error',
        workflowId: 'wf-1',
        error: { name: 'Error', message: 'test' },
      };
      expect(isWorkflowEvent(event)).toBe(true);
    });

    it('should return false for non-workflow events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isWorkflowEvent(event)).toBe(false);
    });
  });

  describe('isCompactionEvent', () => {
    it('should return true for compaction events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'compaction.start',
        strategy: 'truncate-oldest',
        tokensBefore: 1000,
      };
      expect(isCompactionEvent(event)).toBe(true);
    });

    it('should return false for non-compaction events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isCompactionEvent(event)).toBe(false);
    });
  });

  describe('isPermissionEvent', () => {
    it('should return true for permission events', () => {
      const event: AgentEvent = {
        ...baseEvent,
        type: 'permission.prompt',
        promptId: 'perm-1',
        permission: 'file_write',
      };
      expect(isPermissionEvent(event)).toBe(true);
    });

    it('should return false for non-permission events', () => {
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'stop' };
      expect(isPermissionEvent(event)).toBe(false);
    });
  });
});

// ============================================================
// Helper Functions
// ============================================================

describe('serializeError', () => {
  it('should serialize Error instance', () => {
    const error = new Error('Test error');
    const serialized = serializeError(error);

    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('Test error');
    expect(serialized.stack).toBeDefined();
  });

  it('should serialize TypeError', () => {
    const error = new TypeError('Type error');
    const serialized = serializeError(error);

    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('Type error');
  });

  it('should handle non-Error values', () => {
    expect(serializeError('string error')).toEqual({
      name: 'UnknownError',
      message: 'string error',
    });

    expect(serializeError(123)).toEqual({
      name: 'UnknownError',
      message: '123',
    });

    expect(serializeError(null)).toEqual({
      name: 'UnknownError',
      message: 'null',
    });

    expect(serializeError(undefined)).toEqual({
      name: 'UnknownError',
      message: 'undefined',
    });
  });
});

describe('generateId', () => {
  it('should generate unique IDs', () => {
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).not.toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
  });

  it('should generate IDs with prefix', () => {
    const id = generateId('session');

    expect(id.startsWith('session-')).toBe(true);
  });

  it('should generate IDs with different prefixes', () => {
    const sessionId = generateId('session');
    const toolId = generateId('tool');

    expect(sessionId.startsWith('session-')).toBe(true);
    expect(toolId.startsWith('tool-')).toBe(true);
    expect(sessionId).not.toBe(toolId);
  });
});
