import { z } from 'zod';
import { Observable } from 'rxjs';
import type { ToolContext } from './tool/context';
import type { ToolResult } from './tool/result';

export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolArguments: z.string().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const ToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolParametersSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).optional(),
});
export type ToolParameters = z.infer<typeof ToolParametersSchema>;

// ========== Tool Interface (New) ==========

/**
 * Modern Tool interface with full context support.
 *
 * @template P - Parameter type (Zod schema inference)
 * @template M - Metadata type
 *
 * @example
 * ```typescript
 * const ReadTool: Tool<ReadParams, ReadMetadata> = {
 *   name: 'read',
 *   description: 'Read file contents',
 *   parameters: ReadParamsSchema,
 *   async execute(args, ctx) {
 *     ctx.metadata({ title: `Reading ${args.file}...` })
 *     const content = await readFile(args.file, 'utf-8')
 *     return { title: 'Read', output: content, metadata: { path: args.file } }
 *   }
 * }
 * ```
 */
export interface Tool<P = unknown, M = unknown> {
  /** Tool name (unique identifier) */
  name: string;

  /** Tool description (static or dynamic based on context) */
  description: string | ((ctx: ToolContext) => string);

  /** Zod schema for parameter validation */
  parameters?: z.ZodType<P>;

  /** Execute function with full context */
  execute(args: P, ctx: ToolContext): Promise<ToolResult<M>>;
}

// ========== Legacy Tool Interface ==========

/**
 * Legacy Tool interface for backward compatibility.
 * Tools using this interface receive no context.
 */
export interface LegacyTool {
  name: string;
  description: string;
  parameters?: ToolParameters;
  execute(args: Record<string, unknown>): Promise<string>;
}

/** Schema for legacy tool validation */
export const LegacyToolSchema = z.object({
  name: z.string().min(1, 'Tool name is required'),
  description: z.string(),
  parameters: ToolParametersSchema.optional(),
  execute: z.custom<(args: Record<string, unknown>) => Promise<string>>(
    (fn) => typeof fn === 'function',
    { message: 'Tool must have an execute function' }
  ),
});

// ========== Type Guards ==========

/**
 * Check if a tool uses the new interface (receives context).
 */
export function isNewTool(tool: unknown): tool is Tool<unknown, unknown> {
  if (typeof tool !== 'object' || tool === null) return false;
  const t = tool as Record<string, unknown>;
  return (
    typeof t['name'] === 'string' &&
    (typeof t['description'] === 'string' || typeof t['description'] === 'function') &&
    typeof t['execute'] === 'function' &&
    t['execute'].length >= 2 // New interface has 2 parameters
  );
}

/**
 * Check if a tool uses the legacy interface (no context).
 */
export function isLegacyTool(tool: unknown): tool is LegacyTool {
  return LegacyToolSchema.safeParse(tool).success;
}

/**
 * Validate and normalize a tool to either new or legacy interface.
 * @throws Error if tool is invalid
 */
export function validateTool(tool: unknown): Tool | LegacyTool {
  if (isNewTool(tool)) return tool;
  if (isLegacyTool(tool)) return tool;
  throw new Error('Invalid tool: must implement either Tool or LegacyTool interface');
}

export const ToolCallResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.string(),
  toolArguments: z.string().optional(),
});
export type ToolCallResult = z.infer<typeof ToolCallResultSchema>;

export const LLMResponseSchema = z.object({
  content: z.string().nullable(),
  toolCalls: z.array(ToolCallSchema).optional(),
  finishReason: z.enum(['stop', 'tool-calls', 'length', 'error']).optional(),
});
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    type: z.literal('tool_call_start'),
    id: z.string(),
    name: z.string(),
  }),
  z.object({
    type: z.literal('tool_call_delta'),
    id: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal('tool_call_end'),
    id: z.string(),
    result: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    response: LLMResponseSchema,
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export type LLMAdapter = {
  chat(messages: Message[]): Promise<LLMResponse>;
  chatStream(messages: Message[]): Observable<StreamEvent>;
};

export interface RequestContext {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface RequestInterceptor {
  beforeRequest?(context: RequestContext): Promise<RequestContext> | RequestContext;
}

export interface TimeoutConfig {
  total?: number;
  firstToken?: number;
  chunk?: number;
}

export type HistoryManager = {
  add(role: 'system' | 'user' | 'assistant' | 'tool', content: string): void;
  addToolResult(toolCallId: string, toolName: string, result: string, toolArguments?: string): void;
  getMessages(): Message[];
  clear(): void;
};

import type { SandboxConfig } from './sandbox/types.js';

export interface AgentConfig {
  maxSteps?: number;
  systemPrompt?: string;
  sandbox?: SandboxConfig;
}

export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'completed',
  'cancelled',
  'error',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export interface TaskState {
  status: TaskStatus;
  step: number;
  maxSteps: number;
  error?: string;
}

export interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type TaskStateMachine = {
  transition(status: TaskStatus, payload?: { error?: string; step?: number }): void;
  getState(): TaskState;
  onStateChange(callback: (state: TaskState) => void): () => void;
  cancel(): void;
  pause(): void;
  resume(): void;
};

export function createInitialTaskState(maxSteps: number = Infinity): TaskState {
  return {
    status: 'pending',
    step: 0,
    maxSteps,
  };
}

export function createTaskStateMachine(maxSteps: number): TaskStateMachine {
  let state = createInitialTaskState(maxSteps);
  const listeners: ((state: TaskState) => void)[] = [];

  return {
    transition(status: TaskStatus, payload?: { error?: string; step?: number }) {
      if (
        state.status === 'cancelled' ||
        state.status === 'completed' ||
        state.status === 'error'
      ) {
        return;
      }
      state = { ...state, status, ...payload };
      listeners.forEach((cb) => cb(state));
    },
    getState(): TaskState {
      return { ...state };
    },
    onStateChange(callback: (state: TaskState) => void): () => void {
      listeners.push(callback);
      const callbackRef = callback;
      return () => {
        const index = listeners.indexOf(callbackRef);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    cancel() {
      if (
        state.status === 'cancelled' ||
        state.status === 'completed' ||
        state.status === 'error'
      ) {
        return;
      }
      state = { ...state, status: 'cancelled' };
      listeners.forEach((cb) => cb(state));
    },
    pause() {
      if (state.status === 'running') {
        state = { ...state, status: 'paused' };
        listeners.forEach((cb) => cb(state));
      }
    },
    resume() {
      if (state.status === 'paused') {
        state = { ...state, status: 'running' };
        listeners.forEach((cb) => cb(state));
      }
    },
  };
}

export function validateMessage(message: unknown): Message {
  return MessageSchema.parse(message);
}

export function validateLLMResponse(response: unknown): LLMResponse {
  return LLMResponseSchema.parse(response);
}

export const schemas = {
  Message: MessageSchema,
  LegacyTool: LegacyToolSchema,
  ToolCall: ToolCallSchema,
  ToolCallResult: ToolCallResultSchema,
  LLMResponse: LLMResponseSchema,
  StreamEvent: StreamEventSchema,
  TaskStatus: TaskStatusSchema,
} as const;

export type Schemas = typeof schemas;

// ========== Backward Compatibility ==========

/**
 * @deprecated Use `Tool<P, M>` with context support instead.
 * This alias is provided for backward compatibility.
 */
export type LegacyToolType = LegacyTool;
