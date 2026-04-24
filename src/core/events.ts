/**
 * AgentForge Event Types
 *
 * Core event schemas for the Agent event stream architecture.
 * All events are validated with Zod at boundaries (Tier 1/2).
 *
 * @see docs/RXJS-EVENT-STREAM-DESIGN.md
 */

import { z } from 'zod';

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
  // ===== Layer 1: Core Agent Loop =====
  'agent.start',
  'agent.step',
  'agent.complete',
  'agent.error',

  'llm.request',
  'llm.stream.start',
  'llm.stream.text',
  'llm.stream.tool_call',
  'llm.stream.end',
  'llm.response',
  'llm.error',
  'llm.output.invalid',

  'tool.call',
  'tool.execute',
  'tool.result.delta',
  'tool.result',
  'tool.error',
  'tool.batch',
  'tool.batch.start',
  'tool.batch.complete',

  'hitl.ask',
  'hitl.answer',

  'state.change',
  'checkpoint',
  'cancel',
  'done',

  // ===== Layer 2: Subsystem Lifecycle =====
  'subagent.start',
  'subagent.step',
  'subagent.complete',
  'subagent.error',

  'mcp.connecting',
  'mcp.connected',
  'mcp.disconnected',
  'mcp.tools_changed',

  'workflow.start',
  'workflow.step.start',
  'workflow.step.end',
  'workflow.suspend',
  'workflow.resume',
  'workflow.complete',

  'compaction.start',
  'compaction.complete',

  // ===== Layer 3: Cross-cutting Concerns =====
  'permission.prompt',
  'permission.decision',
  'context.updated',
]);

export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

// ============================================================
// Common Schemas
// ============================================================

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const FinishReasonSchema = z.enum([
  'stop',
  'tool_calls',
  'length',
  'error',
  'cancelled',
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

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
    type: z.literal('agent.step'),
    timestamp: z.number(),
    sessionId: z.string(),
    step: z.number(),
    maxSteps: z.number(),
  }),

  z.object({
    type: z.literal('agent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
    steps: z.number(),
    tokens: z.object({ input: z.number(), output: z.number() }).optional(),
  }),

  z.object({
    type: z.literal('agent.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
    step: z.number().optional(),
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
    type: z.literal('llm.stream.start'),
    timestamp: z.number(),
    sessionId: z.string(),
  }),

  z.object({
    type: z.literal('llm.stream.text'),
    timestamp: z.number(),
    sessionId: z.string(),
    delta: z.string(),
  }),

  z.object({
    type: z.literal('llm.stream.tool_call'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    argsDelta: z.string(),
  }),

  z.object({
    type: z.literal('llm.stream.end'),
    timestamp: z.number(),
    sessionId: z.string(),
  }),

  z.object({
    type: z.literal('llm.response'),
    timestamp: z.number(),
    sessionId: z.string(),
    content: z.string(),
    toolCalls: ToolCallSchema.array().optional(),
    finishReason: FinishReasonSchema,
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    }).optional(),
  }),

  z.object({
    type: z.literal('llm.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
  }),

  z.object({
    type: z.literal('llm.output.invalid'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: z.string(),
    originalResponse: z.unknown(),
    attempt: z.number(),
  }),

  // ----- tool.* -----
  z.object({
    type: z.literal('tool.call'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),

  z.object({
    type: z.literal('tool.execute'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
  }),

  z.object({
    type: z.literal('tool.result.delta'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    delta: z.string(),
  }),

  z.object({
    type: z.literal('tool.result'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.string(),
    isError: z.boolean().default(false),
  }),

  z.object({
    type: z.literal('tool.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    error: SerializedErrorSchema,
  }),

  z.object({
    type: z.literal('tool.batch'),
    timestamp: z.number(),
    sessionId: z.string(),
    batchId: z.string(),
    calls: z.array(z.object({
      toolCallId: z.string(),
      toolName: z.string(),
      args: z.record(z.string(), z.unknown()),
    })),
  }),

  z.object({
    type: z.literal('tool.batch.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    batchId: z.string(),
    totalCalls: z.number(),
  }),

  z.object({
    type: z.literal('tool.batch.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    batchId: z.string(),
    totalCalls: z.number(),
    successCount: z.number(),
    errorCount: z.number(),
    durationMs: z.number(),
  }),

  // ----- hitl.* -----
  z.object({
    type: z.literal('hitl.ask'),
    timestamp: z.number(),
    sessionId: z.string(),
    askId: z.string(),
    question: z.string(),
    options: z.string().array().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),

  z.object({
    type: z.literal('hitl.answer'),
    timestamp: z.number(),
    sessionId: z.string(),
    askId: z.string(),
    answer: z.string(),
  }),

  // ----- state.* -----
  z.object({
    type: z.literal('state.change'),
    timestamp: z.number(),
    sessionId: z.string(),
    from: z.string(),
    to: z.string(),
  }),

  // ----- checkpoint -----
  z.object({
    type: z.literal('checkpoint'),
    timestamp: z.number(),
    sessionId: z.string(),
    checkpointId: z.string(),
    position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
    state: z.unknown(),
  }),

  // ----- control -----
  z.object({
    type: z.literal('cancel'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: z.string().optional(),
  }),

  z.object({
    type: z.literal('done'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: FinishReasonSchema,
  }),

  // ----- context.updated -----
  z.object({
    type: z.literal('context.updated'),
    timestamp: z.number(),
    sessionId: z.string(),
    source: z.enum(['skill_loaded', 'config_changed', 'tool_registered', 'mcp_connected', 'manual']),
    changes: z.object({
      toolsAdded: z.string().array().optional(),
      toolsRemoved: z.string().array().optional(),
      skillsLoaded: z.string().array().optional(),
      configChanged: z.record(z.string(), z.unknown()).optional(),
    }),
    previousContext: z.unknown().optional(),
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
    type: z.literal('subagent.step'),
    timestamp: z.number(),
    sessionId: z.string(),
    step: z.number(),
  }),

  z.object({
    type: z.literal('subagent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
  }),

  z.object({
    type: z.literal('subagent.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
  }),

  // ----- mcp.* -----
  z.object({
    type: z.literal('mcp.connecting'),
    timestamp: z.number(),
    sessionId: z.string(),
    serverName: z.string(),
  }),

  z.object({
    type: z.literal('mcp.connected'),
    timestamp: z.number(),
    sessionId: z.string(),
    serverName: z.string(),
    tools: z.string().array().optional(),
  }),

  z.object({
    type: z.literal('mcp.disconnected'),
    timestamp: z.number(),
    sessionId: z.string(),
    serverName: z.string(),
    reason: z.string().optional(),
  }),

  z.object({
    type: z.literal('mcp.tools_changed'),
    timestamp: z.number(),
    sessionId: z.string(),
    serverName: z.string(),
    added: z.string().array().optional(),
    removed: z.string().array().optional(),
  }),

  // ----- workflow.* -----
  z.object({
    type: z.literal('workflow.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    workflowId: z.string(),
    workflowName: z.string(),
  }),

  z.object({
    type: z.literal('workflow.step.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    workflowId: z.string(),
    stepId: z.string(),
    stepName: z.string(),
  }),

  z.object({
    type: z.literal('workflow.step.end'),
    timestamp: z.number(),
    sessionId: z.string(),
    workflowId: z.string(),
    stepId: z.string(),
    result: z.enum(['success', 'failure', 'skipped']),
  }),

  z.object({
    type: z.literal('workflow.suspend'),
    timestamp: z.number(),
    sessionId: z.string(),
    workflowId: z.string(),
    reason: z.string(),
    waitingFor: z.string().optional(),
  }),

  z.object({
    type: z.literal('workflow.resume'),
    timestamp: z.number(),
    sessionId: z.string(),
    workflowId: z.string(),
    resumeFrom: z.string().optional(),
  }),

  z.object({
    type: z.literal('workflow.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    workflowId: z.string(),
    result: z.unknown(),
  }),

  // ----- compaction.* -----
  z.object({
    type: z.literal('compaction.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    strategy: z.enum(['truncate-oldest', 'summarize', 'importance-weighted']),
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

  // ----- permission.* -----
  z.object({
    type: z.literal('permission.prompt'),
    timestamp: z.number(),
    sessionId: z.string(),
    promptId: z.string(),
    permission: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),

  z.object({
    type: z.literal('permission.decision'),
    timestamp: z.number(),
    sessionId: z.string(),
    promptId: z.string(),
    decision: z.enum(['allow', 'deny', 'allow_always']),
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
export function isLLMEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `llm.${string}` }> {
  return event.type.startsWith('llm.');
}

/** Check if event is a tool event */
export function isToolEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `tool.${string}` }> {
  return event.type.startsWith('tool.');
}

/** Check if event is a HITL event */
export function isHITLEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `hitl.${string}` }> {
  return event.type.startsWith('hitl.');
}

/** Check if event is an agent lifecycle event */
export function isAgentLifecycleEvent(event: AgentEvent): event is Extract<AgentEvent, { type: `agent.${string}` }> {
  return event.type.startsWith('agent.');
}

/** Check if event is a terminal event (indicates loop should stop) */
export function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'done' || event.type === 'agent.error' || event.type === 'cancel';
}

// ============================================================
// Event Helpers
// ============================================================

/** Create serialized error from Error instance */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
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
