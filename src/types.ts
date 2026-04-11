import { z } from 'zod';
import { Observable } from 'rxjs';

export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
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

export const ToolSchema = z.object({
  name: z.string().min(1, 'Tool name is required'),
  description: z.string(),
  parameters: ToolParametersSchema.optional(),
  execute: z.custom<(args: Record<string, unknown>) => Promise<string>>(
    (fn) => typeof fn === 'function',
    { message: 'Tool must have an execute function' }
  ),
});
export type Tool = z.infer<typeof ToolSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.string(),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

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
  add(role: 'user' | 'assistant' | 'tool', content: string): void;
  addToolResult(toolCallId: string, toolName: string, result: string): void;
  getMessages(): Message[];
  clear(): void;
};

export interface AgentConfig {
  maxSteps?: number;
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
  onStateChange(callback: (state: TaskState) => void): void;
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
    onStateChange(callback: (state: TaskState) => void) {
      listeners.push(callback);
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

export function validateTool(tool: unknown): Tool {
  return ToolSchema.parse(tool);
}

export function validateMessage(message: unknown): Message {
  return MessageSchema.parse(message);
}

export function validateLLMResponse(response: unknown): LLMResponse {
  return LLMResponseSchema.parse(response);
}

export const schemas = {
  Message: MessageSchema,
  Tool: ToolSchema,
  ToolCall: ToolCallSchema,
  ToolResult: ToolResultSchema,
  LLMResponse: LLMResponseSchema,
  StreamEvent: StreamEventSchema,
  TaskStatus: TaskStatusSchema,
} as const;

export type Schemas = typeof schemas;
