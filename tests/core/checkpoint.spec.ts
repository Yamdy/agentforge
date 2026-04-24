/**
 * Unit tests for src/core/checkpoint.ts
 *
 * Tests Checkpoint schema, idempotency helpers, A2A helpers, recovery, and serialization.
 */

import { describe, it, expect } from 'vitest';
import {
  CheckpointPositionSchema,
  type CheckpointPosition,
  A2APendingRequestSchema,
  type A2APendingRequest,
  ExecutedToolSchema,
  type ExecutedTool,
  RecoveryMetadataSchema,
  type RecoveryMetadata,
  CompactionHistorySchema,
  type CompactionHistory,
  CheckpointSchema,
  type Checkpoint,
  type CreateCheckpointOptions,
  createCheckpoint,
  generateIdempotencyKey,
  isToolExecuted,
  getToolResult,
  recordToolExecution,
  hasPendingA2A,
  getPendingA2ARequests,
  updateA2AStatus,
  createRecoveryCheckpoint,
  getRecoveryInfo,
  recordCompaction as recordCheckpointCompaction,
  getTotalCompactionSavings,
  serializeCheckpoint,
  deserializeCheckpoint,
} from '../../src/core/checkpoint.js';
import {
  type AgentState,
  createInitialState,
} from '../../src/core/state.js';

// ============================================================
// Schema Tests
// ============================================================

describe('CheckpointPositionSchema', () => {
  it('should validate all positions', () => {
    const positions: CheckpointPosition[] = [
      'before_llm',
      'after_llm',
      'before_tool',
      'after_tool',
    ];
    for (const pos of positions) {
      expect(CheckpointPositionSchema.safeParse(pos).success).toBe(true);
    }
  });

  it('should reject invalid positions', () => {
    expect(CheckpointPositionSchema.safeParse('during_llm').success).toBe(false);
  });
});

describe('A2APendingRequestSchema', () => {
  it('should validate A2A pending request', () => {
    const req: A2APendingRequest = {
      requestId: 'req-1',
      targetAgent: 'researcher',
      requestType: 'request',
      payload: { query: 'test' },
      sentAt: Date.now(),
      status: 'pending',
    };
    expect(A2APendingRequestSchema.safeParse(req).success).toBe(true);
  });

  it('should validate all request types', () => {
    const types: A2APendingRequest['requestType'][] = ['request', 'notify', 'broadcast'];
    for (const type of types) {
      const req = {
        requestId: 'req-1',
        targetAgent: 'agent',
        requestType: type,
        payload: {},
        sentAt: Date.now(),
        status: 'pending' as const,
      };
      expect(A2APendingRequestSchema.safeParse(req).success).toBe(true);
    }
  });

  it('should validate all statuses', () => {
    const statuses: A2APendingRequest['status'][] = ['pending', 'acknowledged', 'responded', 'timeout'];
    for (const status of statuses) {
      const req = {
        requestId: 'req-1',
        targetAgent: 'agent',
        requestType: 'request' as const,
        payload: {},
        sentAt: Date.now(),
        status,
      };
      expect(A2APendingRequestSchema.safeParse(req).success).toBe(true);
    }
  });
});

describe('ExecutedToolSchema', () => {
  it('should validate executed tool record', () => {
    const tool: ExecutedTool = {
      toolCallId: 'tc-1',
      toolName: 'weather',
      idempotencyKey: 'session-1:tc-1',
      executedAt: Date.now(),
    };
    expect(ExecutedToolSchema.safeParse(tool).success).toBe(true);
  });

  it('should validate with optional resultHash', () => {
    const tool: ExecutedTool = {
      toolCallId: 'tc-1',
      toolName: 'weather',
      idempotencyKey: 'session-1:tc-1',
      executedAt: Date.now(),
      resultHash: 'abc123',
    };
    expect(ExecutedToolSchema.safeParse(tool).success).toBe(true);
  });
});

describe('RecoveryMetadataSchema', () => {
  it('should validate minimal metadata', () => {
    const meta: RecoveryMetadata = {};
    expect(RecoveryMetadataSchema.safeParse(meta).success).toBe(true);
  });

  it('should validate full metadata', () => {
    const meta: RecoveryMetadata = {
      originalSessionId: 'original-session',
      recoveryCount: 2,
      lastRecoveryAt: Date.now(),
    };
    expect(RecoveryMetadataSchema.safeParse(meta).success).toBe(true);
  });
});

describe('CompactionHistorySchema', () => {
  it('should validate compaction history record', () => {
    const history: CompactionHistory = {
      compactionId: 'comp-1',
      timestamp: Date.now(),
      strategy: 'truncate-oldest',
      tokensBefore: 2000,
      tokensAfter: 1000,
      removedMessageCount: 5,
      summarizedMessageCount: 0,
    };
    expect(CompactionHistorySchema.safeParse(history).success).toBe(true);
  });

  it('should validate all strategies', () => {
    const strategies: CompactionHistory['strategy'][] = [
      'truncate-oldest',
      'summarize',
      'importance-weighted',
    ];
    for (const strategy of strategies) {
      const history = {
        compactionId: 'comp-1',
        timestamp: Date.now(),
        strategy,
        tokensBefore: 2000,
        tokensAfter: 1000,
        removedMessageCount: 5,
        summarizedMessageCount: 0,
      };
      expect(CompactionHistorySchema.safeParse(history).success).toBe(true);
    }
  });

  it('should validate with snapshotRef', () => {
    const history: CompactionHistory = {
      compactionId: 'comp-1',
      timestamp: Date.now(),
      strategy: 'summarize',
      tokensBefore: 2000,
      tokensAfter: 500,
      removedMessageCount: 2,
      summarizedMessageCount: 10,
      snapshotRef: 's3://snapshots/comp-1.json',
    };
    expect(CompactionHistorySchema.safeParse(history).success).toBe(true);
  });
});

// ============================================================
// Checkpoint Schema Tests
// ============================================================

describe('CheckpointSchema', () => {
  const createTestState = (): AgentState => createInitialState({
    sessionId: 'session-1',
    agentName: 'assistant',
    model: { provider: 'openai', model: 'gpt-4' },
  });

  it('should validate minimal checkpoint', () => {
    const checkpoint = {
      id: 'cp-1',
      sessionId: 'session-1',
      timestamp: Date.now(),
      position: 'after_llm' as const,
      state: createTestState(),
    };
    expect(CheckpointSchema.safeParse(checkpoint).success).toBe(true);
  });

  it('should validate full checkpoint', () => {
    const checkpoint: Checkpoint = {
      id: 'cp-1',
      sessionId: 'session-1',
      timestamp: Date.now(),
      position: 'after_tool',
      state: createTestState(),
      pendingEvent: {
        type: 'tool.result',
        timestamp: Date.now(),
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        toolName: 'weather',
        result: '{"temp": 25}',
        isError: false,
      },
      pendingA2A: [
        {
          requestId: 'req-1',
          targetAgent: 'researcher',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'pending',
        },
      ],
      executedTools: [
        {
          toolCallId: 'tc-1',
          toolName: 'weather',
          idempotencyKey: 'session-1:tc-1',
          executedAt: Date.now(),
        },
      ],
      recoveryMetadata: {
        recoveryCount: 1,
        lastRecoveryAt: Date.now(),
      },
      compactionHistory: [
        {
          compactionId: 'comp-1',
          timestamp: Date.now(),
          strategy: 'truncate-oldest',
          tokensBefore: 2000,
          tokensAfter: 1000,
          removedMessageCount: 5,
          summarizedMessageCount: 0,
        },
      ],
    };
    expect(CheckpointSchema.safeParse(checkpoint).success).toBe(true);
  });
});

// ============================================================
// createCheckpoint Tests
// ============================================================

describe('createCheckpoint', () => {
  const createTestState = (): AgentState => createInitialState({
    sessionId: 'session-1',
    agentName: 'assistant',
    model: { provider: 'openai', model: 'gpt-4' },
  });

  it('should create checkpoint with required options', () => {
    const options: CreateCheckpointOptions = {
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createTestState(),
    };

    const checkpoint = createCheckpoint(options);

    expect(checkpoint.id).toBe('cp-1');
    expect(checkpoint.sessionId).toBe('session-1');
    expect(checkpoint.position).toBe('after_llm');
    expect(checkpoint.timestamp).toBeDefined();
    expect(checkpoint.state).toBeDefined();
    expect(checkpoint.pendingA2A).toEqual([]);
    expect(checkpoint.executedTools).toEqual([]);
    expect(checkpoint.recoveryMetadata?.recoveryCount).toBe(0);
    expect(checkpoint.compactionHistory).toEqual([]);
  });

  it('should create checkpoint with all options', () => {
    const options: CreateCheckpointOptions = {
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'before_tool',
      state: createTestState(),
      pendingEvent: {
        type: 'tool.call',
        timestamp: Date.now(),
        sessionId: 'session-1',
        toolCallId: 'tc-1',
        toolName: 'weather',
        args: { city: 'Beijing' },
      },
      pendingA2A: [
        {
          requestId: 'req-1',
          targetAgent: 'researcher',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'pending',
        },
      ],
      executedTools: [
        {
          toolCallId: 'tc-0',
          toolName: 'init',
          idempotencyKey: 'session-1:tc-0',
          executedAt: Date.now(),
        },
      ],
    };

    const checkpoint = createCheckpoint(options);

    expect(checkpoint.pendingEvent).toBeDefined();
    expect(checkpoint.pendingA2A).toHaveLength(1);
    expect(checkpoint.executedTools).toHaveLength(1);
  });
});

// ============================================================
// Idempotency Helpers Tests
// ============================================================

describe('generateIdempotencyKey', () => {
  it('should generate key from sessionId and toolCallId', () => {
    const key = generateIdempotencyKey('session-1', 'tc-1');
    expect(key).toBe('session-1:tc-1');
  });

  it('should generate unique keys for different combinations', () => {
    const key1 = generateIdempotencyKey('session-1', 'tc-1');
    const key2 = generateIdempotencyKey('session-1', 'tc-2');
    const key3 = generateIdempotencyKey('session-2', 'tc-1');

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });
});

describe('isToolExecuted', () => {
  const createTestCheckpoint = (): Checkpoint => createCheckpoint({
    id: 'cp-1',
    sessionId: 'session-1',
    position: 'after_tool',
    state: createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    }),
    executedTools: [
      {
        toolCallId: 'tc-1',
        toolName: 'weather',
        idempotencyKey: 'session-1:tc-1',
        executedAt: Date.now(),
      },
    ],
  });

  it('should return true for executed tool', () => {
    const checkpoint = createTestCheckpoint();
    expect(isToolExecuted(checkpoint, 'tc-1')).toBe(true);
  });

  it('should return false for non-executed tool', () => {
    const checkpoint = createTestCheckpoint();
    expect(isToolExecuted(checkpoint, 'tc-2')).toBe(false);
  });

  it('should return false for checkpoint without executedTools', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });
    expect(isToolExecuted(checkpoint, 'tc-1')).toBe(false);
  });
});

describe('getToolResult', () => {
  it('should return tool result from messages', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      initialMessages: [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: '{"temp": 25}', toolCallId: 'tc-1', name: 'weather' },
      ],
    });

    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_tool',
      state,
    });

    expect(getToolResult(checkpoint, 'tc-1')).toBe('{"temp": 25}');
  });

  it('should return undefined for non-existent tool result', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    expect(getToolResult(checkpoint, 'tc-999')).toBeUndefined();
  });
});

describe('recordToolExecution', () => {
  it('should record tool execution', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'before_tool',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    const updated = recordToolExecution(checkpoint, {
      toolCallId: 'tc-1',
      toolName: 'weather',
      idempotencyKey: 'session-1:tc-1',
    });

    expect(updated.executedTools).toHaveLength(1);
    expect(updated.executedTools?.[0].toolCallId).toBe('tc-1');
    expect(updated.executedTools?.[0].executedAt).toBeDefined();
  });
});

// ============================================================
// A2A Helpers Tests
// ============================================================

describe('hasPendingA2A', () => {
  it('should return true for pending requests', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      pendingA2A: [
        {
          requestId: 'req-1',
          targetAgent: 'researcher',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'pending',
        },
      ],
    });

    expect(hasPendingA2A(checkpoint)).toBe(true);
  });

  it('should return false for no pending requests', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    expect(hasPendingA2A(checkpoint)).toBe(false);
  });

  it('should return false for non-pending statuses', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      pendingA2A: [
        {
          requestId: 'req-1',
          targetAgent: 'researcher',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'responded',
        },
      ],
    });

    expect(hasPendingA2A(checkpoint)).toBe(false);
  });
});

describe('getPendingA2ARequests', () => {
  it('should return pending and acknowledged requests', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      pendingA2A: [
        {
          requestId: 'req-1',
          targetAgent: 'agent1',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'pending',
        },
        {
          requestId: 'req-2',
          targetAgent: 'agent2',
          requestType: 'notify',
          payload: {},
          sentAt: Date.now(),
          status: 'acknowledged',
        },
        {
          requestId: 'req-3',
          targetAgent: 'agent3',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'responded',
        },
      ],
    });

    const pending = getPendingA2ARequests(checkpoint);
    expect(pending).toHaveLength(2);
    expect(pending.map(r => r.requestId)).toContain('req-1');
    expect(pending.map(r => r.requestId)).toContain('req-2');
  });
});

describe('updateA2AStatus', () => {
  it('should update A2A request status', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      pendingA2A: [
        {
          requestId: 'req-1',
          targetAgent: 'researcher',
          requestType: 'request',
          payload: {},
          sentAt: Date.now(),
          status: 'pending',
        },
      ],
    });

    const updated = updateA2AStatus(checkpoint, 'req-1', 'responded');

    expect(updated.pendingA2A?.[0].status).toBe('responded');
  });
});

// ============================================================
// Recovery Helpers Tests
// ============================================================

describe('createRecoveryCheckpoint', () => {
  it('should create recovery checkpoint with new session ID', () => {
    const original = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_tool',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    const recovered = createRecoveryCheckpoint(original, 'session-2');

    expect(recovered.sessionId).toBe('session-2');
    expect(recovered.id).not.toBe('cp-1');
    expect(recovered.recoveryMetadata?.originalSessionId).toBe('session-1');
    expect(recovered.recoveryMetadata?.recoveryCount).toBe(1);
    expect(recovered.recoveryMetadata?.lastRecoveryAt).toBeDefined();
  });

  it('should increment recovery count on multiple recoveries', () => {
    const original = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_tool',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      recoveryMetadata: {
        recoveryCount: 1,
        originalSessionId: 'session-0',
      },
    });

    const recovered = createRecoveryCheckpoint(original, 'session-2');

    expect(recovered.recoveryMetadata?.recoveryCount).toBe(2);
    expect(recovered.recoveryMetadata?.originalSessionId).toBe('session-1');
  });
});

describe('getRecoveryInfo', () => {
  it('should return info for checkpoint without recovery', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    const info = getRecoveryInfo(checkpoint);

    expect(info.hasRecovery).toBe(false);
    expect(info.recoveryCount).toBe(0);
    expect(info.originalSessionId).toBeUndefined();
  });

  it('should return info for recovered checkpoint', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-2',
      position: 'after_tool',
      state: createInitialState({
        sessionId: 'session-2',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      recoveryMetadata: {
        originalSessionId: 'session-1',
        recoveryCount: 2,
        lastRecoveryAt: Date.now(),
      },
    });

    const info = getRecoveryInfo(checkpoint);

    expect(info.hasRecovery).toBe(true);
    expect(info.recoveryCount).toBe(2);
    expect(info.originalSessionId).toBe('session-1');
  });
});

// ============================================================
// Compaction History Tests
// ============================================================

describe('recordCheckpointCompaction', () => {
  it('should record compaction event', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    const updated = recordCheckpointCompaction(checkpoint, {
      compactionId: 'comp-1',
      strategy: 'truncate-oldest',
      tokensBefore: 2000,
      tokensAfter: 1000,
      removedMessageCount: 5,
      summarizedMessageCount: 0,
    });

    expect(updated.compactionHistory).toHaveLength(1);
    expect(updated.compactionHistory?.[0].compactionId).toBe('comp-1');
    expect(updated.compactionHistory?.[0].timestamp).toBeDefined();
  });
});

describe('getTotalCompactionSavings', () => {
  it('should return total tokens saved', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
      compactionHistory: [
        {
          compactionId: 'comp-1',
          timestamp: Date.now(),
          strategy: 'truncate-oldest',
          tokensBefore: 2000,
          tokensAfter: 1000,
          removedMessageCount: 5,
          summarizedMessageCount: 0,
        },
        {
          compactionId: 'comp-2',
          timestamp: Date.now(),
          strategy: 'summarize',
          tokensBefore: 1500,
          tokensAfter: 500,
          removedMessageCount: 3,
          summarizedMessageCount: 10,
        },
      ],
    });

    expect(getTotalCompactionSavings(checkpoint)).toBe(2000); // (2000-1000) + (1500-500)
  });

  it('should return 0 for no compaction history', () => {
    const checkpoint = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_llm',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
      }),
    });

    expect(getTotalCompactionSavings(checkpoint)).toBe(0);
  });
});

// ============================================================
// Serialization Tests
// ============================================================

describe('serializeCheckpoint / deserializeCheckpoint', () => {
  it('should serialize and deserialize checkpoint', () => {
    const original = createCheckpoint({
      id: 'cp-1',
      sessionId: 'session-1',
      position: 'after_tool',
      state: createInitialState({
        sessionId: 'session-1',
        agentName: 'assistant',
        model: { provider: 'openai', model: 'gpt-4' },
        initialMessages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
      }),
      executedTools: [
        {
          toolCallId: 'tc-1',
          toolName: 'weather',
          idempotencyKey: 'session-1:tc-1',
          executedAt: Date.now(),
        },
      ],
    });

    const serialized = serializeCheckpoint(original);
    expect(typeof serialized).toBe('string');

    const deserialized = deserializeCheckpoint(serialized);
    expect(deserialized.id).toBe(original.id);
    expect(deserialized.sessionId).toBe(original.sessionId);
    expect(deserialized.position).toBe(original.position);
    expect(deserialized.state.messages).toHaveLength(2);
    expect(deserialized.executedTools).toHaveLength(1);
  });

  it('should throw on invalid JSON', () => {
    expect(() => deserializeCheckpoint('not json')).toThrow();
  });

  it('should throw on invalid checkpoint structure', () => {
    expect(() => deserializeCheckpoint('{"invalid": true}')).toThrow();
  });
});
