/**
 * AgentForge Event Types
 *
 * Core event schemas for the Agent event stream architecture.
 * All events are validated with Zod at boundaries (Tier 1/2).
 *
 */

import { z } from 'zod';
import type { Logger } from './logger.js';

// ============================================================
// Event Type Enumeration
// ============================================================

/**
 * All event types in the Agent system.
 *
 * Layer 1: Core Agent Loop events
 * Layer 2: Subsystem lifecycle events
 * Layer 3: Cross-cutting concern events
 */
export const AgentEventTypeSchema = z.enum([
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
]);

export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

// ============================================================
// Common Schemas
// ============================================================

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/**
 * Message metadata for importance-weighted compaction and source tracking.
 * @see design/01-CORE-TYPES.md
 */
export const MessageMetadataSchema = z.object({
  /** Pinned messages are preserved during compaction */
  pinned: z.boolean().optional(),
  /** Message mark type */
  mark: z.enum(['hint', 'summary', 'pinned']).optional(),
  /** Importance score (0-1) for importance-weighted compaction */
  importance: z.number().min(0).max(1).optional(),
  /** Source tracking */
  source: z.enum(['user', 'agent', 'tool', 'system', 'memory']).optional(),
  /** Creation timestamp */
  createdAt: z.number().optional(),
});
export type MessageMetadata = z.infer<typeof MessageMetadataSchema>;

/**
 * ContentPart — a single part of a multimodal message.
 * Either plain text or an image_url reference.
 *
 * Compatible with OpenAI's vision API content part format.
 */
export const ContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(['auto', 'low', 'high']).optional(),
    }),
  }),
]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

/**
 * MessageContent — either a plain string or an array of ContentParts.
 *
 * Backward compatible: plain strings (current format) continue to work unchanged.
 * Multimodal: pass a ContentPart[] to include images alongside text.
 */
export const MessageContentSchema = z.union([z.string(), z.array(ContentPartSchema)]);
export type MessageContent = z.infer<typeof MessageContentSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: MessageContentSchema,
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  /** Optional message metadata for compaction and tracking */
  metadata: MessageMetadataSchema.optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const FinishReasonSchema = z.enum(['stop', 'tool_calls', 'length', 'error', 'cancelled']);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

/** Agent loop termination reason — semantically distinct from LLM finish_reason. */
export const AgentTerminationReasonSchema = z.enum(['completed', 'error', 'cancelled']);
export type AgentTerminationReason = z.infer<typeof AgentTerminationReasonSchema>;

/**
 * Serialized Error Schema
 *
 * z.instanceof(Error) cannot be serialized across process/storage boundaries.
 * Use this structure instead for all error events.
 */
export const SerializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  code: z.string().optional(),
});
export type SerializedError = z.infer<typeof SerializedErrorSchema>;

// ============================================================
// Event Definitions (Discriminated Union)
// ============================================================

export const AgentEventSchema = z.discriminatedUnion('type', [
  // ----- agent.* -----
  z.object({
    type: z.literal('agent.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    input: z.string(),
    agentName: z.string(),
    model: z.object({ provider: z.string(), model: z.string() }),
  }),

  z.object({
    type: z.literal('agent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
    steps: z.number(),
    tokens: z.object({ input: z.number(), output: z.number() }).optional(),
    /** Total step count executed (was agent.step) */
    stepCount: z.number().optional(),
  }),

  z.object({
    type: z.literal('agent.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
    step: z.number().optional(),
    /** Event source: 'agent' for main loop, 'subagent' for subagent errors (was subagent.error) */
    source: z.enum(['agent', 'subagent']).optional(),
  }),

  // ----- session.* -----
  z.object({
    type: z.literal('session.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    agentName: z.string(),
    model: z.object({ provider: z.string(), model: z.string() }),
    correlation: z
      .object({
        userId: z.string().optional(),
        orgId: z.string().optional(),
        environment: z.string().optional(),
      })
      .optional(),
  }),

  z.object({
    type: z.literal('session.end'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: z.string(),
    summary: z.object({
      steps: z.number(),
      tokens: z.object({ input: z.number(), output: z.number() }).optional(),
      duration: z.number(),
    }),
  }),

  // ----- llm.* -----
  z.object({
    type: z.literal('llm.request'),
    timestamp: z.number(),
    sessionId: z.string(),
    messages: MessageSchema.array(),
    model: z.object({ provider: z.string(), model: z.string() }),
    tools: z.string().array().optional(),
  }),

  z.object({
    type: z.literal('llm.response'),
    timestamp: z.number(),
    sessionId: z.string(),
    content: z.string(),
    toolCalls: ToolCallSchema.array().optional(),
    finishReason: FinishReasonSchema,
    usage: z
      .object({
        promptTokens: z.number(),
        completionTokens: z.number(),
        cacheReadTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
      })
      .optional(),
    ttftMs: z.number().optional(),
    // P1: Reasoning capture for decision traceability
    reasoning: z
      .object({
        rawOutput: z.string().optional(),
        thoughtProcess: z.string().optional(),
        model: z.string().optional(),
        confidence: z.number().min(0).max(1).optional(),
      })
      .optional(),
  }),

  // ----- llm.first_token -----
  z.object({
    type: z.literal('llm.first_token'),
    timestamp: z.number(),
    sessionId: z.string(),
    ttftMs: z.number(),
  }),

  // ----- tool.* -----
  z.object({
    type: z.literal('tool.call'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
    /** Batch ID when tool is executed as part of a parallel batch (was tool.batch.start) */
    batchId: z.string().optional(),
  }),

  z.object({
    type: z.literal('tool.result'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.string(),
    isError: z.boolean().default(false),
    errorType: z
      .enum(['timeout', 'validation', 'execution', 'permission', 'not_found', 'network'])
      .optional(),
    // P1: Structured output validation fields
    structuredOutput: z.unknown().optional(),
    isValid: z.boolean().optional(),
    validationError: z.string().optional(),
    // Tool output truncation metadata
    truncated: z.boolean().optional(),
    originalLength: z.number().optional(),
    /** Batch ID when tool result is part of a parallel batch (was tool.batch.complete) */
    batchId: z.string().optional(),
  }),

  // ----- state.* -----
  z.object({
    type: z.literal('state.change'),
    timestamp: z.number(),
    sessionId: z.string(),
    from: z.string(),
    to: z.string(),
    /** Checkpoint metadata when state change is a checkpoint save (was separate checkpoint event) */
    checkpoint: z
      .object({
        id: z.string(),
        position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
      })
      .optional(),
  }),

  // ----- control -----
  z.object({
    type: z.literal('done'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: AgentTerminationReasonSchema,
  }),

  // ----- subagent.* -----
  z.object({
    type: z.literal('subagent.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    parentSessionId: z.string(),
    subagentName: z.string(),
    input: z.string(),
  }),

  z.object({
    type: z.literal('subagent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
  }),

  // ----- compaction.* -----
  z.object({
    type: z.literal('compaction.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    strategy: z.enum([
      'truncate-oldest',
      'summarize',
      'importance-weighted',
      'snip',
      'pointer-indexed',
      'microcompact',
    ]),
    tokensBefore: z.number(),
  }),

  z.object({
    type: z.literal('compaction.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    tokensAfter: z.number(),
    removedMessages: z.number(),
    summarizedMessages: z.number().optional(),
  }),

  // ----- permission (merged prompt + decision) -----
  z.object({
    type: z.literal('permission'),
    timestamp: z.number(),
    sessionId: z.string(),
    promptId: z.string(),
    permission: z.string(),
    /** Decision, if already made (allow/deny/allow_always) — omitted for prompt-only events */
    decision: z.enum(['allow', 'deny', 'allow_always']).optional(),
    /** Context for the permission request (risk level, tool args, etc.) */
    context: z.record(z.string(), z.unknown()).optional(),
  }),

  // ----- evaluation.complete -----
  z.object({
    type: z.literal('evaluation.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    runId: z.string(),
    compositeScore: z.number().min(0).max(1),
    scorers: z.array(
      z.object({
        name: z.string(),
        score: z.number(),
        weight: z.number(),
      })
    ),
  }),

  // ----- feedback -----
  z.object({
    type: z.literal('feedback'),
    timestamp: z.number(),
    sessionId: z.string(),
    feedbackType: z.string(),
    value: z.number(),
    comment: z.string().optional(),
  }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ============================================================
// Type Guards
// ============================================================

/** Check if an unknown value is a valid AgentEvent */
export function isAgentEvent(event: unknown): event is AgentEvent {
  return AgentEventSchema.safeParse(event).success;
}

/** Check if event is an LLM event */
export function isLLMEvent(
  event: AgentEvent
): event is Extract<AgentEvent, { type: `llm.${string}` }> {
  return event.type.startsWith('llm.');
}

/** Check if event is a tool event */
export function isToolEvent(
  event: AgentEvent
): event is Extract<AgentEvent, { type: `tool.${string}` }> {
  return event.type.startsWith('tool.');
}

/** Check if event is an agent lifecycle event */
export function isAgentLifecycleEvent(
  event: AgentEvent
): event is Extract<AgentEvent, { type: `agent.${string}` }> {
  return event.type.startsWith('agent.');
}

/** Check if event is a terminal event (indicates loop should stop) */
export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'agent.error';
}

/** Check if event is a Compaction event */
export function isCompactionEvent(
  event: AgentEvent
): event is Extract<AgentEvent, { type: `compaction.${string}` }> {
  return event.type.startsWith('compaction.');
}

/** Check if event is a session lifecycle event */
export function isSessionEvent(
  event: AgentEvent
): event is Extract<AgentEvent, { type: `session.${string}` }> {
  return event.type.startsWith('session.');
}

// ============================================================
// Streaming Chunk Event (lightweight — no Zod validation)
// ============================================================

/**
 * Lightweight streaming chunk event.
 *
 * Intentionally NOT in AgentEventTypeSchema z.enum — chunks bypass Zod
 * validation for performance (streaming fires 10s of times per second).
 * TypeScript types provide sufficient safety for the simple delta structure.
 */
export interface LLMChunkEvent {
  type: 'llm.chunk';
  delta: string;
  index: number;
  timestamp: number;
  sessionId: string;
}

// ============================================================
// Event Helpers
// ============================================================

/** Create serialized error from Error instance */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(code ? { code } : {}),
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
  };
}

/** Generate unique ID for events/sessions/requests */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

// ============================================================
// Agent Event Emitter (lightweight custom implementation)
// ============================================================

/**
 * Lightweight typed event emitter for Agent events.
 *
 * Lightweight event distribution with type-safe emit/on/onAny API.
 * Listeners can be registered per-event-type or catch-all.
 * All listeners are fire-and-forget — errors in one listener
 * do not affect others.
 */
export class AgentEventEmitter {
  private typed = new Map<string, Set<(event: unknown) => void | Promise<void>>>();
  private any = new Set<(event: AgentEvent) => void | Promise<void>>();
  private chunkListeners = new Set<(chunk: LLMChunkEvent) => void | Promise<void>>();

  constructor(private logger?: Logger) {}

  /**
   * Register a listener for a specific event type.
   * Listeners may return void or Promise<void> — emit awaits all.
   * @returns Unregister function
   */
  on<T extends AgentEvent['type']>(
    type: T,
    fn: (event: Extract<AgentEvent, { type: T }>) => void | Promise<void>
  ): () => void {
    const existing = this.typed.get(type);
    if (existing) {
      existing.add(fn as (event: unknown) => void | Promise<void>);
    } else {
      this.typed.set(type, new Set([fn as (event: unknown) => void | Promise<void>]));
    }
    return () => {
      const set = this.typed.get(type);
      if (set) set.delete(fn as (event: unknown) => void | Promise<void>);
    };
  }

  /**
   * Register a catch-all listener for ALL event types.
   * @returns Unregister function
   */
  onAny(fn: (event: AgentEvent) => void | Promise<void>): () => void {
    this.any.add(fn);
    return () => {
      this.any.delete(fn);
    };
  }

  /**
   * Emit an event to all registered listeners.
   * Typed listeners fire first, then catch-all listeners.
   * Errors in listeners are silently caught (never propagate).
   */
  async emit(event: AgentEvent): Promise<void> {
    const tasks: Promise<void>[] = [];

    // Typed listeners
    const typedSet = this.typed.get(event.type);
    if (typedSet) {
      for (const fn of typedSet) {
        tasks.push(
          Promise.resolve()
            .then(() => fn(event))
            .catch((listenerError: unknown) => {
              this.logger?.warn('Event listener error', {
                eventType: event.type,
                error: serializeError(listenerError),
              });
            })
        );
      }
    }

    // Catch-all listeners
    for (const fn of this.any) {
      tasks.push(
        Promise.resolve()
          .then(() => fn(event))
          .catch((listenerError: unknown) => {
            this.logger?.warn('Event listener error', {
              eventType: event.type,
              error: serializeError(listenerError),
            });
          })
      );
    }

    await Promise.allSettled(tasks);
  }

  /**
   * Emit a streaming text chunk through the fast path (no Zod validation).
   *
   * Chunks are high-frequency events during streaming. Zod validation
   * overhead would be measurable at 10+ chunks/second.
   */
  emitChunk(delta: string, metadata?: { index?: number }): void {
    const chunk: LLMChunkEvent = {
      type: 'llm.chunk',
      delta,
      index: metadata?.index ?? 0,
      timestamp: Date.now(),
      sessionId: '',
    };
    for (const fn of this.chunkListeners) {
      Promise.resolve()
        .then(() => fn(chunk))
        .catch((err: unknown) => {
          this.logger?.warn('Chunk listener error', { error: serializeError(err as Error) });
        });
    }
  }

  /**
   * Subscribe to streaming chunk events.
   * Returns an unsubscribe function.
   */
  onChunk(fn: (chunk: LLMChunkEvent) => void | Promise<void>): () => void {
    this.chunkListeners.add(fn);
    return () => {
      this.chunkListeners.delete(fn);
    };
  }

  /**
   * Remove all listeners (typed, any, and chunk).
   */
  clear(): void {
    this.typed.clear();
    this.any.clear();
    this.chunkListeners.clear();
  }
}
