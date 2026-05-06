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
  AgentEventEmitter,
  type LLMChunkEvent,
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isAgentLifecycleEvent,
  isTerminalEvent,
  isCompactionEvent,
  serializeError,
  generateId,
} from '../../src/core/events.js';

// ============================================================
// Event Type Enumeration
// ============================================================

describe('AgentEventTypeSchema', () => {
  it('should have exactly 19 event types', () => {
    const types = AgentEventTypeSchema.options;
    expect(types.length).toBe(19);
  });

  it('should validate all 19 event types', () => {
    const allEvents = [
      'agent.start',
      'agent.complete',
      'agent.error',
      'llm.request',
      'llm.response',
      'llm.first_token',
      'tool.call',
      'tool.result',
      'state.change',
      'done',
      'session.start',
      'session.end',
      'subagent.start',
      'subagent.complete',
      'compaction.start',
      'compaction.complete',
      'permission',
      'evaluation.complete',
      'feedback',
    ];

    for (const event of allEvents) {
      expect(AgentEventTypeSchema.safeParse(event).success).toBe(true);
    }
  });

  it('should reject deleted event types', () => {
    const deletedEvents = [
      'agent.step',
      'llm.chunk',
      'file.change',
      'tool.batch.start',
      'tool.batch.complete',
      'checkpoint',
      'subagent.error',
      'mcp.connecting',
      'mcp.connected',
      'mcp.disconnected',
      'mcp.error',
      'workflow.start',
      'workflow.step.start',
      'workflow.step.end',
      'workflow.complete',
      'workflow.error',
      'permission.prompt',
      'permission.decision',
    ];

    for (const event of deletedEvents) {
      expect(AgentEventTypeSchema.safeParse(event).success).toBe(false);
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

    it('should validate agent.complete with optional tokens and stepCount', () => {
      const event = {
        type: 'agent.complete' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        output: 'Done',
        steps: 3,
        stepCount: 3,
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

    it('should validate agent.error with optional step and source', () => {
      const event = {
        type: 'agent.error' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        error: { name: 'Error', message: 'Failed' },
        step: 5,
        source: 'subagent' as const,
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

  describe('tool events with batchId', () => {
    it('should validate tool.call with optional batchId', () => {
      const event = {
        type: 'tool.call' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        toolCallId: 'tc-1',
        toolName: 'weather',
        args: {},
        batchId: 'batch-1',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate tool.result with optional batchId', () => {
      const event = {
        type: 'tool.result' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        toolCallId: 'tc-1',
        toolName: 'weather',
        result: 'ok',
        isError: false,
        batchId: 'batch-1',
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
        reason: 'completed' as const,
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate state.change with checkpoint info', () => {
      const event = {
        type: 'state.change' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        from: 'running',
        to: 'running',
        checkpoint: { id: 'cp-1', position: 'after_llm' as const },
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

    it('should validate subagent.complete event', () => {
      const event = {
        type: 'subagent.complete' as const,
        timestamp: Date.now(),
        sessionId: 'sub-session-1',
        output: 'Found results',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should reject deleted subagent.error event', () => {
      const event = {
        type: 'subagent.error' as const,
        timestamp: Date.now(),
        sessionId: 'sub-session-1',
        error: { name: 'TimeoutError', message: 'Subagent timed out' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(false);
    });
  });

  describe('mcp events (removed from AgentEvent)', () => {
    it('should reject mcp.connecting event (MCP uses own event system)', () => {
      const event = {
        type: 'mcp.connecting' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        serverName: 'filesystem',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(false);
    });
  });

  describe('workflow events (removed from AgentEvent)', () => {
    it('should reject workflow.start event (workflow uses own event system)', () => {
      const event = {
        type: 'workflow.start' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        workflowId: 'wf-1',
        workflowName: 'Data Processing',
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(false);
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
    it('should validate permission event (merged prompt + decision)', () => {
      const event = {
        type: 'permission' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        promptId: 'perm-1',
        permission: 'file_write',
        context: { path: '/data/output.txt' },
      };
      expect(AgentEventSchema.safeParse(event).success).toBe(true);
    });

    it('should validate permission event with decision', () => {
      const event = {
        type: 'permission' as const,
        timestamp: Date.now(),
        sessionId: 'session-123',
        promptId: 'perm-1',
        permission: 'file_write',
        decision: 'allow' as const,
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
      const event = { ...baseEvent, type: 'done', reason: 'completed' };
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
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'completed' };
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
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'completed' };
      expect(isToolEvent(event)).toBe(false);
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
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'completed' };
      expect(isAgentLifecycleEvent(event)).toBe(false);
    });
  });

  describe('isTerminalEvent', () => {
    it('should return true for terminal events', () => {
      const doneEvent: AgentEvent = { ...baseEvent, type: 'done', reason: 'completed' };
      const errorEvent: AgentEvent = {
        ...baseEvent,
        type: 'agent.error',
        error: { name: 'Error', message: 'test' },
      };

      expect(isTerminalEvent(doneEvent)).toBe(true);
      expect(isTerminalEvent(errorEvent)).toBe(true);
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
      const event: AgentEvent = { ...baseEvent, type: 'done', reason: 'completed' };
      expect(isCompactionEvent(event)).toBe(false);
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

// ============================================================
// AgentEventEmitter.emitChunk — fast path streaming chunks
// ============================================================

describe('AgentEventEmitter.emitChunk', () => {
  it('delivers chunks to onChunk subscribers', async () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];

    emitter.onChunk(chunk => received.push(chunk));
    emitter.emitChunk('hello', { index: 0 });
    emitter.emitChunk(' world', { index: 1 });

    // Flush microtasks (listeners fire via Promise.resolve().then())
    await new Promise(r => setTimeout(r, 0));

    expect(received).toHaveLength(2);
    expect(received[0]!.delta).toBe('hello');
    expect(received[0]!.index).toBe(0);
    expect(received[1]!.delta).toBe(' world');
  });

  it('does not trigger typed event listeners', async () => {
    const emitter = new AgentEventEmitter();
    let typedReceived = false;
    const chunkReceived: LLMChunkEvent[] = [];

    emitter.on('llm.request', () => {
      typedReceived = true;
    });
    emitter.onChunk(chunk => chunkReceived.push(chunk));

    emitter.emitChunk('test');
    await new Promise(r => setTimeout(r, 0));

    expect(typedReceived).toBe(false);
    expect(chunkReceived).toHaveLength(1);
  });

  it('onChunk returns unsubscribe function', async () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];

    const unsub = emitter.onChunk(chunk => received.push(chunk));
    emitter.emitChunk('first');
    await new Promise(r => setTimeout(r, 0));
    unsub();
    emitter.emitChunk('second');
    await new Promise(r => setTimeout(r, 0));

    expect(received).toHaveLength(1);
  });

  it('listener errors do not crash other listeners', async () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];

    emitter.onChunk(() => {
      throw new Error('boom');
    });
    emitter.onChunk(chunk => received.push(chunk));

    expect(() => emitter.emitChunk('test')).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
    expect(received).toHaveLength(1);
  });

  it('handles 10000 chunks (performance smoke test)', async () => {
    const emitter = new AgentEventEmitter();
    let count = 0;
    emitter.onChunk(() => {
      count++;
    });

    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      emitter.emitChunk('x', { index: i });
    }
    const elapsed = Date.now() - start;

    // Flush microtasks so listeners execute
    await new Promise(r => setTimeout(r, 0));

    expect(count).toBe(10000);
    expect(elapsed).toBeLessThan(1000);
  });

  it('clear() removes chunk listeners', async () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];
    emitter.onChunk(chunk => received.push(chunk));
    emitter.clear();
    emitter.emitChunk('test');
    await new Promise(r => setTimeout(r, 0));
    expect(received).toHaveLength(0);
  });
});
