/**
 * Unit tests for src/core/state.ts
 *
 * Tests AgentState schema, state creation, and immutable update helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  BatchContextSchema,
  type BatchContext,
  ContextManagementSchema,
  type ContextManagement,
  CheckpointReferenceSchema,
  type CheckpointReference,
  ModelConfigSchema,
  type ModelConfig,
  TokenStatsSchema,
  type TokenStats,
  AgentStateSchema,
  type AgentState,
  type CreateInitialStateOptions,
  createInitialState,
  updateState,
  appendMessage,
  appendMessages,
  incrementStep,
  isMaxStepsReached,
  updateTokens,
  setPendingToolCalls,
  clearPendingToolCalls,
  setBatchContext,
  clearBatchContext,
  updateLastCheckpoint,
  setOutput,
  initContextManagement,
  recordCompaction as recordStateCompaction,
} from '../../src/core/state.js';

// ============================================================
// Schema Tests
// ============================================================

describe('BatchContextSchema', () => {
  it('should validate batch context', () => {
    const ctx: BatchContext = {
      batchId: 'batch-1',
      totalCalls: 3,
      completedCalls: 0,
      startedAt: Date.now(),
    };
    expect(BatchContextSchema.safeParse(ctx).success).toBe(true);
  });

  it('should reject missing fields', () => {
    expect(BatchContextSchema.safeParse({ batchId: 'b1' }).success).toBe(false);
  });
});

describe('ContextManagementSchema', () => {
  it('should validate context management state', () => {
    const ctx: ContextManagement = {
      totalTokens: 1000,
      compactionCount: 2,
      lastCompactionAt: Date.now(),
    };
    expect(ContextManagementSchema.safeParse(ctx).success).toBe(true);
  });

  it('should use defaults', () => {
    const result = ContextManagementSchema.parse({ totalTokens: 500 });
    expect(result.compactionCount).toBe(0);
  });
});

describe('CheckpointReferenceSchema', () => {
  it('should validate checkpoint reference', () => {
    const ref: CheckpointReference = {
      id: 'cp-1',
      timestamp: Date.now(),
      position: 'after_llm',
    };
    expect(CheckpointReferenceSchema.safeParse(ref).success).toBe(true);
  });

  it('should validate all positions', () => {
    const positions: CheckpointReference['position'][] = [
      'before_llm',
      'after_llm',
      'before_tool',
      'after_tool',
    ];
    for (const pos of positions) {
      const ref = { id: 'cp-1', timestamp: Date.now(), position: pos };
      expect(CheckpointReferenceSchema.safeParse(ref).success).toBe(true);
    }
  });
});

describe('ModelConfigSchema', () => {
  it('should validate model config', () => {
    const config: ModelConfig = {
      provider: 'openai',
      model: 'gpt-4',
    };
    expect(ModelConfigSchema.safeParse(config).success).toBe(true);
  });

  it('should reject missing fields', () => {
    expect(ModelConfigSchema.safeParse({ provider: 'openai' }).success).toBe(false);
  });
});

describe('TokenStatsSchema', () => {
  it('should validate token stats', () => {
    const stats: TokenStats = {
      prompt: 100,
      completion: 50,
    };
    expect(TokenStatsSchema.safeParse(stats).success).toBe(true);
  });
});

// ============================================================
// AgentState Schema Tests
// ============================================================

describe('AgentStateSchema', () => {
  it('should validate minimal agent state', () => {
    const state = {
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      messages: [],
      step: 0,
      maxSteps: 10,
      pendingToolCalls: [],
      output: '',
      tokens: { prompt: 0, completion: 0 },
      recovery: {
        outputTokenEscalationCount: 0,
        recoveryMessageCount: 0,
        fallbackSwitchCount: 0,
        compactionRetryCount: 0,
      },
    };
    expect(AgentStateSchema.safeParse(state).success).toBe(true);
  });

  it('should validate full agent state', () => {
    const state: AgentState = {
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ],
      step: 1,
      maxSteps: 10,
      pendingToolCalls: [],
      output: 'Hi!',
      tokens: { prompt: 10, completion: 5 },
      recovery: {
        outputTokenEscalationCount: 0,
        recoveryMessageCount: 0,
        fallbackSwitchCount: 0,
        compactionRetryCount: 0,
      },
      batchContext: {
        batchId: 'batch-1',
        totalCalls: 2,
        completedCalls: 1,
        startedAt: Date.now(),
      },
      contextManagement: {
        totalTokens: 1000,
        compactionCount: 0,
      },
      lastCheckpoint: {
        id: 'cp-1',
        timestamp: Date.now(),
        position: 'after_llm',
      },
    };
    expect(AgentStateSchema.safeParse(state).success).toBe(true);
  });

  it('should reject missing required fields', () => {
    expect(AgentStateSchema.safeParse({}).success).toBe(false);
    expect(AgentStateSchema.safeParse({ sessionId: 's1' }).success).toBe(false);
  });
});

// ============================================================
// createInitialState Tests
// ============================================================

describe('createInitialState', () => {
  it('should create state with required options', () => {
    const options: CreateInitialStateOptions = {
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    };

    const state = createInitialState(options);

    expect(state.sessionId).toBe('session-1');
    expect(state.agentName).toBe('assistant');
    expect(state.model).toEqual({ provider: 'openai', model: 'gpt-4' });
    expect(state.messages).toEqual([]);
    expect(state.step).toBe(0);
    expect(state.maxSteps).toBe(10);
    expect(state.pendingToolCalls).toEqual([]);
    expect(state.output).toBe('');
    expect(state.tokens).toEqual({ prompt: 0, completion: 0 });
  });

  it('should use custom maxSteps', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      maxSteps: 20,
    });

    expect(state.maxSteps).toBe(20);
  });

  it('should include initial messages', () => {
    const messages = [
      { role: 'system' as const, content: 'You are helpful.' },
    ];

    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      initialMessages: messages,
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(messages[0]);
  });
});

// ============================================================
// Immutable Update Helpers Tests
// ============================================================

describe('updateState', () => {
  const baseState: AgentState = createInitialState({
    sessionId: 'session-1',
    agentName: 'assistant',
    model: { provider: 'openai', model: 'gpt-4' },
  });

  it('should create new state object', () => {
    const newState = updateState(baseState, { step: 1 });
    
    expect(newState).not.toBe(baseState);
    expect(newState.step).toBe(1);
    expect(baseState.step).toBe(0); // Original unchanged
  });

  it('should update multiple fields', () => {
    const newState = updateState(baseState, {
      step: 2,
      output: 'Hello',
      tokens: { prompt: 100, completion: 50 },
    });

    expect(newState.step).toBe(2);
    expect(newState.output).toBe('Hello');
    expect(newState.tokens).toEqual({ prompt: 100, completion: 50 });
  });

  it('should validate the result', () => {
    // Should throw if invalid
    expect(() => updateState(baseState, { step: 'invalid' as unknown as number })).toThrow();
  });
});

describe('appendMessage', () => {
  it('should append message to empty state', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const newState = appendMessage(state, { role: 'user', content: 'Hello' });

    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(state.messages).toHaveLength(0); // Original unchanged
  });

  it('should append message to existing messages', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      initialMessages: [{ role: 'system', content: 'System' }],
    });

    const newState = appendMessage(state, { role: 'user', content: 'Hello' });

    expect(newState.messages).toHaveLength(2);
    expect(newState.messages[1]).toEqual({ role: 'user', content: 'Hello' });
  });
});

describe('appendMessages', () => {
  it('should append multiple messages', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const newState = appendMessages(state, [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ]);

    expect(newState.messages).toHaveLength(2);
  });
});

describe('incrementStep', () => {
  it('should increment step counter', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    expect(state.step).toBe(0);
    
    const state1 = incrementStep(state);
    expect(state1.step).toBe(1);
    
    const state2 = incrementStep(state1);
    expect(state2.step).toBe(2);
  });
});

describe('isMaxStepsReached', () => {
  it('should return false when step < maxSteps', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      maxSteps: 10,
    });

    const state2 = incrementStep(incrementStep(state));
    expect(isMaxStepsReached(state2)).toBe(false);
  });

  it('should return true when step >= maxSteps', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
      maxSteps: 2,
    });

    const state2 = incrementStep(incrementStep(state));
    expect(isMaxStepsReached(state2)).toBe(true);
  });
});

describe('updateTokens', () => {
  it('should accumulate tokens', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const state1 = updateTokens(state, 100, 50);
    expect(state1.tokens).toEqual({ prompt: 100, completion: 50 });

    const state2 = updateTokens(state1, 200, 100);
    expect(state2.tokens).toEqual({ prompt: 300, completion: 150 });
  });
});

describe('setPendingToolCalls', () => {
  it('should set pending tool calls', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const toolCalls = [
      { id: 'tc-1', name: 'weather', args: { city: 'Beijing' } },
    ];

    const newState = setPendingToolCalls(state, toolCalls);

    expect(newState.pendingToolCalls).toHaveLength(1);
    expect(newState.pendingToolCalls[0]).toEqual(toolCalls[0]);
  });
});

describe('clearPendingToolCalls', () => {
  it('should clear pending tool calls', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const stateWithCalls = setPendingToolCalls(state, [
      { id: 'tc-1', name: 'weather', args: {} },
    ]);

    const clearedState = clearPendingToolCalls(stateWithCalls);

    expect(clearedState.pendingToolCalls).toHaveLength(0);
  });
});

describe('setBatchContext', () => {
  it('should set batch context', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const batchCtx: BatchContext = {
      batchId: 'batch-1',
      totalCalls: 3,
      completedCalls: 0,
      startedAt: Date.now(),
    };

    const newState = setBatchContext(state, batchCtx);

    expect(newState.batchContext).toEqual(batchCtx);
  });
});

describe('clearBatchContext', () => {
  it('should clear batch context', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const stateWithBatch = setBatchContext(state, {
      batchId: 'batch-1',
      totalCalls: 3,
      completedCalls: 0,
      startedAt: Date.now(),
    });

    const clearedState = clearBatchContext(stateWithBatch);

    expect(clearedState.batchContext).toBeUndefined();
  });
});

describe('updateLastCheckpoint', () => {
  it('should update last checkpoint reference', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const checkpoint: CheckpointReference = {
      id: 'cp-1',
      timestamp: Date.now(),
      position: 'after_llm',
    };

    const newState = updateLastCheckpoint(state, checkpoint);

    expect(newState.lastCheckpoint).toEqual(checkpoint);
  });
});

describe('setOutput', () => {
  it('should set output string', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const newState = setOutput(state, 'Hello, world!');

    expect(newState.output).toBe('Hello, world!');
  });
});

// ============================================================
// Context Management Helpers Tests
// ============================================================

describe('initContextManagement', () => {
  it('should initialize context management state', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const newState = initContextManagement(state, 1000);

    expect(newState.contextManagement).toBeDefined();
    expect(newState.contextManagement?.totalTokens).toBe(1000);
    expect(newState.contextManagement?.compactionCount).toBe(0);
  });
});

describe('recordStateCompaction', () => {
  it('should record compaction event', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const stateWithCtx = initContextManagement(state, 2000);
    const newState = recordStateCompaction(stateWithCtx, 1000);

    expect(newState.contextManagement?.totalTokens).toBe(1000);
    expect(newState.contextManagement?.compactionCount).toBe(1);
    expect(newState.contextManagement?.lastCompactionAt).toBeDefined();
  });

  it('should return unchanged state if no context management', () => {
    const state = createInitialState({
      sessionId: 'session-1',
      agentName: 'assistant',
      model: { provider: 'openai', model: 'gpt-4' },
    });

    const newState = recordStateCompaction(state, 1000);

    expect(newState.contextManagement).toBeUndefined();
  });
});
