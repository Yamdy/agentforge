/**
 * AgentForge Checkpoint System
 *
 * Checkpoint definition and recovery utilities for agent resumption.
 *
 * Key concepts:
 * - Checkpoint granularity: Step-level (after_llm / after_tool), not event-level
 * - Idempotency: Tools can be safely re-executed on recovery
 * - Cross-process state: A2A pending requests are tracked
 *
 */

import { z } from 'zod';
import { AgentEventSchema } from './events.js';
import { AgentStateSchema } from './state.js';

// ============================================================
// Checkpoint Position
// ============================================================

/**
 * Checkpoint position semantics
 *
 * | Position     | Meaning                  | Recovery Start Point      |
 * |--------------|--------------------------|---------------------------|
 * | before_llm   | Before LLM request       | Make LLM request          |
 * | after_llm    | After LLM response       | Process toolCalls         |
 * | before_tool  | Before tool execution    | Execute tool              |
 * | after_tool   | After tool completion    | Next LLM request          |
 *
 * Recovery granularity: Step-level, not event-level
 * - One Step = LLM call + tool execution (if any)
 * - Checkpoints saved at stable boundaries
 * - Recovery continues from that boundary
 */
export const CheckpointPositionSchema = z.enum([
  'before_llm',
  'after_llm',
  'before_tool',
  'after_tool',
]);

export type CheckpointPosition = z.infer<typeof CheckpointPositionSchema>;

// ============================================================
// A2A Pending Request
// ============================================================

export const A2APendingRequestSchema = z.object({
  requestId: z.string(),
  targetAgent: z.string(),
  requestType: z.enum(['request', 'notify', 'broadcast']),
  payload: z.unknown(),
  sentAt: z.number(),
  status: z.enum(['pending', 'acknowledged', 'responded', 'timeout']),
});

export type A2APendingRequest = z.infer<typeof A2APendingRequestSchema>;

// ============================================================
// Executed Tool Record (Idempotency)
// ============================================================

export const ExecutedToolSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  idempotencyKey: z.string(), // Used to avoid re-execution on recovery
  executedAt: z.number(),
  resultHash: z.string().optional(), // Hash for consistency verification
});

export type ExecutedTool = z.infer<typeof ExecutedToolSchema>;

// ============================================================
// Recovery Metadata
// ============================================================

export const RecoveryMetadataSchema = z.object({
  originalSessionId: z.string().optional(), // Original session ID if recovered to new session
  recoveryCount: z.number().default(0),
  lastRecoveryAt: z.number().optional(),
});

export type RecoveryMetadata = z.infer<typeof RecoveryMetadataSchema>;

// ============================================================
// Compaction History Record
// ============================================================

export const CompactionHistorySchema = z.object({
  compactionId: z.string(),
  timestamp: z.number(),
  strategy: z.enum(['truncate-oldest', 'summarize', 'importance-weighted']),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
  removedMessageCount: z.number(),
  summarizedMessageCount: z.number(),
  snapshotRef: z.string().optional(), // Reference to pre-compaction snapshot (external storage)
});

export type CompactionHistory = z.infer<typeof CompactionHistorySchema>;

// ============================================================
// Checkpoint Schema
// ============================================================

/**
 * Checkpoint Schema
 *
 * Captures complete agent state for resumption.
 * Serializable to JSON for storage and cross-process transfer.
 */
export const CheckpointSchema = z.object({
  // Identity
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.number(),

  // Position in agent loop
  position: CheckpointPositionSchema,

  // Complete agent state
  state: AgentStateSchema,

  // Event being processed at checkpoint time (for debugging)
  pendingEvent: AgentEventSchema.optional(),

  // Cross-process state
  pendingA2A: z.array(A2APendingRequestSchema).optional().default([]),

  // Idempotency tracking
  executedTools: z.array(ExecutedToolSchema).optional().default([]),

  // Recovery metadata
  recoveryMetadata: RecoveryMetadataSchema.optional().default({}),

  // Compaction history (for context compression compatibility)
  compactionHistory: z.array(CompactionHistorySchema).optional().default([]),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

// ============================================================
// Checkpoint Creation
// ============================================================

export interface CreateCheckpointOptions {
  id: string;
  sessionId: string;
  position: CheckpointPosition;
  state: z.infer<typeof AgentStateSchema>;
  pendingEvent?: z.infer<typeof AgentEventSchema>;
  pendingA2A?: A2APendingRequest[];
  executedTools?: ExecutedTool[];
  recoveryMetadata?: RecoveryMetadata;
  compactionHistory?: CompactionHistory[];
}

/**
 * Create a new checkpoint
 */
export function createCheckpoint(options: CreateCheckpointOptions): Checkpoint {
  return CheckpointSchema.parse({
    id: options.id,
    sessionId: options.sessionId,
    timestamp: Date.now(),
    position: options.position,
    state: options.state,
    pendingEvent: options.pendingEvent,
    pendingA2A: options.pendingA2A ?? [],
    executedTools: options.executedTools ?? [],
    recoveryMetadata: options.recoveryMetadata ?? {},
    compactionHistory: options.compactionHistory ?? [],
  });
}

// ============================================================
// Idempotency Helpers
// ============================================================

/**
 * Generate idempotency key for a tool call
 *
 * Format: sessionId:toolCallId
 * Used to prevent duplicate tool execution on recovery.
 */
export function generateIdempotencyKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

/**
 * Check if a tool has already been executed
 */
export function isToolExecuted(checkpoint: Checkpoint, toolCallId: string): boolean {
  return checkpoint.executedTools?.some(t => t.toolCallId === toolCallId) ?? false;
}

/**
 * Get tool result from checkpoint (if already executed)
 */
export function getToolResult(checkpoint: Checkpoint, toolCallId: string): string | undefined {
  // Find tool message with matching toolCallId
  const toolMessage = checkpoint.state.messages.find(
    m => m.role === 'tool' && m.toolCallId === toolCallId
  );
  return toolMessage?.content;
}

/**
 * Record a tool execution in the checkpoint
 */
export function recordToolExecution(
  checkpoint: Checkpoint,
  tool: Omit<ExecutedTool, 'executedAt'>
): Checkpoint {
  const executedTools = checkpoint.executedTools ?? [];
  return CheckpointSchema.parse({
    ...checkpoint,
    executedTools: [
      ...executedTools,
      {
        ...tool,
        executedAt: Date.now(),
      },
    ],
  });
}

// ============================================================
// A2A Helpers
// ============================================================

/**
 * Check if there are pending A2A requests
 */
export function hasPendingA2A(checkpoint: Checkpoint): boolean {
  return checkpoint.pendingA2A?.some(r => r.status === 'pending') ?? false;
}

/**
 * Get pending A2A requests that need response
 */
export function getPendingA2ARequests(checkpoint: Checkpoint): A2APendingRequest[] {
  return (
    checkpoint.pendingA2A?.filter(r => r.status === 'pending' || r.status === 'acknowledged') ?? []
  );
}

/**
 * Update A2A request status
 */
export function updateA2AStatus(
  checkpoint: Checkpoint,
  requestId: string,
  status: A2APendingRequest['status']
): Checkpoint {
  const pendingA2A =
    checkpoint.pendingA2A?.map(r => (r.requestId === requestId ? { ...r, status } : r)) ?? [];

  return CheckpointSchema.parse({
    ...checkpoint,
    pendingA2A,
  });
}

// ============================================================
// Recovery Helpers
// ============================================================

/**
 * Create recovery checkpoint (from original checkpoint)
 */
export function createRecoveryCheckpoint(original: Checkpoint, newSessionId: string): Checkpoint {
  const recoveryCount = (original.recoveryMetadata?.recoveryCount ?? 0) + 1;

  return CheckpointSchema.parse({
    ...original,
    id: `recovery-${Date.now()}`,
    sessionId: newSessionId,
    timestamp: Date.now(),
    recoveryMetadata: {
      originalSessionId: original.sessionId,
      recoveryCount,
      lastRecoveryAt: Date.now(),
    },
  });
}

/**
 * Get recovery info summary
 */
export function getRecoveryInfo(checkpoint: Checkpoint): {
  hasRecovery: boolean;
  recoveryCount: number;
  originalSessionId?: string;
} {
  const meta = checkpoint.recoveryMetadata;
  return {
    hasRecovery: (meta?.recoveryCount ?? 0) > 0,
    recoveryCount: meta?.recoveryCount ?? 0,
    ...(meta?.originalSessionId ? { originalSessionId: meta.originalSessionId } : {}),
  };
}

// ============================================================
// Compaction History Helpers
// ============================================================

/**
 * Record a compaction event
 */
export function recordCompaction(
  checkpoint: Checkpoint,
  compaction: Omit<CompactionHistory, 'timestamp'>
): Checkpoint {
  const compactionHistory = checkpoint.compactionHistory ?? [];
  return CheckpointSchema.parse({
    ...checkpoint,
    compactionHistory: [
      ...compactionHistory,
      {
        ...compaction,
        timestamp: Date.now(),
      },
    ],
  });
}

/**
 * Get total tokens saved by compaction
 */
export function getTotalCompactionSavings(checkpoint: Checkpoint): number {
  return (
    checkpoint.compactionHistory?.reduce((sum, c) => sum + (c.tokensBefore - c.tokensAfter), 0) ?? 0
  );
}

// ============================================================
// Serialization Helpers
// ============================================================

/**
 * Serialize checkpoint to JSON string
 *
 * Performs validation before serialization.
 */
export function serializeCheckpoint(checkpoint: Checkpoint): string {
  // Validate before serialization
  CheckpointSchema.parse(checkpoint);
  return JSON.stringify(checkpoint);
}

/**
 * Deserialize checkpoint from JSON string
 *
 * Validates against schema (Tier 1: external data).
 */
export function deserializeCheckpoint(raw: string): Checkpoint {
  const parsed: unknown = JSON.parse(raw);
  return CheckpointSchema.parse(parsed);
}
