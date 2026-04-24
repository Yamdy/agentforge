/**
 * AgentForge State Management
 *
 * Agent state definition and immutable update utilities.
 *
 * @see docs/RXJS-EVENT-STREAM-DESIGN.md - Core Types section
 */

import { z } from 'zod';
import { MessageSchema, ToolCallSchema } from './events.js';

// ============================================================
// Batch Context (for parallel tool execution tracking)
// ============================================================

export const BatchContextSchema = z.object({
  batchId: z.string(),
  totalCalls: z.number(),
  completedCalls: z.number(),
  startedAt: z.number(),
});

export type BatchContext = z.infer<typeof BatchContextSchema>;

// ============================================================
// Context Management State
// ============================================================

export const ContextManagementSchema = z.object({
  totalTokens: z.number(),
  compactionCount: z.number().default(0),
  lastCompactionAt: z.number().optional(),
});

export type ContextManagement = z.infer<typeof ContextManagementSchema>;

// ============================================================
// Checkpoint Reference
// ============================================================

export const CheckpointReferenceSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
});

export type CheckpointReference = z.infer<typeof CheckpointReferenceSchema>;

// ============================================================
// Model Configuration
// ============================================================

export const ModelConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ============================================================
// Token Statistics
// ============================================================

export const TokenStatsSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
});

export type TokenStats = z.infer<typeof TokenStatsSchema>;

// ============================================================
// Agent State
// ============================================================

/**
 * Agent State Schema
 *
 * Represents the complete state of an agent at any point in time.
 * Used for:
 * - State machine transitions
 * - Checkpoint serialization
 * - Debugging/observability
 */
export const AgentStateSchema = z.object({
  // Identity
  sessionId: z.string(),
  agentName: z.string(),
  model: ModelConfigSchema,

  // Conversation
  messages: MessageSchema.array(),

  // Execution state
  step: z.number(),
  maxSteps: z.number(),

  // Pending tool calls (for resumption after tool execution)
  pendingToolCalls: ToolCallSchema.array(),

  // Batch context (when executing parallel tools)
  batchContext: BatchContextSchema.optional(),

  // Output accumulation
  output: z.string(),

  // Token tracking
  tokens: TokenStatsSchema,

  // Context management (compression, memory limits)
  contextManagement: ContextManagementSchema.optional(),

  // Last checkpoint reference
  lastCheckpoint: CheckpointReferenceSchema.optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

// ============================================================
// Initial State Factory
// ============================================================

export interface CreateInitialStateOptions {
  sessionId: string;
  agentName: string;
  model: ModelConfig;
  maxSteps?: number;
  initialMessages?: z.infer<typeof MessageSchema>[];
}

/**
 * Create initial agent state with defaults
 */
export function createInitialState(options: CreateInitialStateOptions): AgentState {
  return {
    sessionId: options.sessionId,
    agentName: options.agentName,
    model: options.model,
    messages: options.initialMessages ?? [],
    step: 0,
    maxSteps: options.maxSteps ?? 10,
    pendingToolCalls: [],
    output: '',
    tokens: {
      prompt: 0,
      completion: 0,
    },
  };
}

// ============================================================
// Immutable State Updates
// ============================================================

/**
 * Immutable state update helper
 *
 * Creates a new state object with the provided updates.
 * Validates the result against the schema.
 */
export function updateState(
  state: AgentState,
  update: Partial<AgentState>,
): AgentState {
  const newState = { ...state, ...update };
  return AgentStateSchema.parse(newState);
}

/**
 * Append a message to the conversation
 */
export function appendMessage(
  state: AgentState,
  message: z.infer<typeof MessageSchema>,
): AgentState {
  return updateState(state, {
    messages: [...state.messages, message],
  });
}

/**
 * Append multiple messages to the conversation
 */
export function appendMessages(
  state: AgentState,
  messages: z.infer<typeof MessageSchema>[],
): AgentState {
  return updateState(state, {
    messages: [...state.messages, ...messages],
  });
}

/**
 * Increment step counter
 */
export function incrementStep(state: AgentState): AgentState {
  return updateState(state, {
    step: state.step + 1,
  });
}

/**
 * Check if max steps reached
 */
export function isMaxStepsReached(state: AgentState): boolean {
  return state.step >= state.maxSteps;
}

/**
 * Update token statistics
 */
export function updateTokens(
  state: AgentState,
  promptTokens: number,
  completionTokens: number,
): AgentState {
  return updateState(state, {
    tokens: {
      prompt: state.tokens.prompt + promptTokens,
      completion: state.tokens.completion + completionTokens,
    },
  });
}

/**
 * Set pending tool calls
 */
export function setPendingToolCalls(
  state: AgentState,
  toolCalls: z.infer<typeof ToolCallSchema>[],
): AgentState {
  return updateState(state, {
    pendingToolCalls: toolCalls,
  });
}

/**
 * Clear pending tool calls
 */
export function clearPendingToolCalls(state: AgentState): AgentState {
  return updateState(state, {
    pendingToolCalls: [],
  });
}

/**
 * Set batch context for parallel tool execution
 */
export function setBatchContext(
  state: AgentState,
  batchContext: BatchContext,
): AgentState {
  return updateState(state, { batchContext });
}

/**
 * Clear batch context
 */
export function clearBatchContext(state: AgentState): AgentState {
  return updateState(state, { batchContext: undefined });
}

/**
 * Update last checkpoint reference
 */
export function updateLastCheckpoint(
  state: AgentState,
  checkpoint: CheckpointReference,
): AgentState {
  return updateState(state, { lastCheckpoint: checkpoint });
}

/**
 * Set output string
 */
export function setOutput(state: AgentState, output: string): AgentState {
  return updateState(state, { output });
}

// ============================================================
// Context Management Helpers
// ============================================================

/**
 * Initialize context management state
 */
export function initContextManagement(state: AgentState, totalTokens: number): AgentState {
  return updateState(state, {
    contextManagement: {
      totalTokens,
      compactionCount: 0,
    },
  });
}

/**
 * Update context management after compaction
 */
export function recordCompaction(
  state: AgentState,
  tokensAfter: number,
): AgentState {
  const ctx = state.contextManagement;
  if (!ctx) {
    return state;
  }

  return updateState(state, {
    contextManagement: {
      ...ctx,
      totalTokens: tokensAfter,
      compactionCount: ctx.compactionCount + 1,
      lastCompactionAt: Date.now(),
    },
  });
}
