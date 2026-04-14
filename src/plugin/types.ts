import { z } from 'zod';
import type { TaskStatus, TimeoutConfig } from '../types.js';

export const HookEvents = {
  TOOL_EXECUTE_BEFORE: 'tool.execute.before',
  TOOL_EXECUTE_AFTER: 'tool.execute.after',
  MESSAGE_TRANSFORM: 'message.transform',
  SYSTEM_PROMPT: 'system.prompt',
  AGENT_STEP: 'agent.step',
  AGENT_ERROR: 'agent.error',
  STATE_CHANGE: 'state.change',
  AGENT_START: 'agent.start',
  AGENT_COMPLETE: 'agent.complete',
  LLM_REQUEST_BEFORE: 'llm.request.before',
  CHAT_MESSAGE: 'chat.message',
  CHAT_PARAMS: 'chat.params',
  CHAT_RESPONSE: 'chat.response',
  CHAT_ERROR: 'chat.error',
  SESSION_COMPACTING: 'session.compacting',
} as const;

export type HookEvent = (typeof HookEvents)[keyof typeof HookEvents];

export interface ToolExecuteBeforeInput {
  tool: string;
  args: Record<string, unknown>;
}
export interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>;
}

export interface ToolExecuteAfterInput {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}
export interface ToolExecuteAfterOutput {
  result: string;
}

export type MessageTransformInput = object;
export interface MessageTransformOutput {
  messages: Record<string, unknown>[];
}

export type SystemPromptInput = object;
export interface SystemPromptOutput {
  prompt: string[];
}

export interface AgentStepInput {
  step: number;
  maxSteps: number;
}
export type AgentStepOutput = object;

export interface AgentErrorInput {
  error: string;
}
export type AgentErrorOutput = object;

export interface StateChangeInput {
  from: TaskStatus;
  to: TaskStatus;
}
export type StateChangeOutput = object;

export interface AgentStartInput {
  userInput: string;
}
export type AgentStartOutput = object;

export interface AgentCompleteInput {
  userInput: string;
  response: string;
}
export type AgentCompleteOutput = object;

export interface LLMRequestBeforeInput {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface LLMRequestBeforeOutput {
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ProviderContext {
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export interface ProviderResult {
  baseURL?: string;
  apiKey?: string;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
  timeout?: TimeoutConfig;
  tlsRejectUnauthorized?: boolean;
}

export interface ChatMessageInput {
  sessionId?: string;
  role: string;
  content: string;
}

export interface ChatMessageOutput {
  content: string;
}

export interface ChatParamsInput {
  sessionId?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ChatParamsOutput {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface ChatResponseInput {
  sessionId?: string;
  finishReason?: string;
  tokens?: { input: number; output: number };
  duration: number;
  responseText: string;
}

export type ChatResponseOutput = object;

export interface ChatErrorInput {
  sessionId?: string;
  error: Error;
  duration: number;
}

export type ChatErrorOutput = object;

export interface SessionCompactingInput {
  sessionId?: string;
  messageCount: number;
}

export interface SessionCompactingOutput {
  context: string[];
  prompt?: string;
}

export type HookFunction = (input: unknown, output: unknown) => Promise<void>;

/**
 * Hook 类型映射表，将每个事件名映射到其输入输出类型
 * 用于实现类型安全的 hook 触发
 */
export interface HookMap {
  'tool.execute.before': {
    input: ToolExecuteBeforeInput;
    output: ToolExecuteBeforeOutput;
  };
  'tool.execute.after': {
    input: ToolExecuteAfterInput;
    output: ToolExecuteAfterOutput;
  };
  'message.transform': {
    input: MessageTransformInput;
    output: MessageTransformOutput;
  };
  'system.prompt': {
    input: SystemPromptInput;
    output: SystemPromptOutput;
  };
  'agent.step': {
    input: AgentStepInput;
    output: AgentStepOutput;
  };
  'agent.error': {
    input: AgentErrorInput;
    output: AgentErrorOutput;
  };
  'state.change': {
    input: StateChangeInput;
    output: StateChangeOutput;
  };
  'agent.start': {
    input: AgentStartInput;
    output: AgentStartOutput;
  };
  'agent.complete': {
    input: AgentCompleteInput;
    output: AgentCompleteOutput;
  };
  'llm.request.before': {
    input: LLMRequestBeforeInput;
    output: LLMRequestBeforeOutput;
  };
  'chat.message': {
    input: ChatMessageInput;
    output: ChatMessageOutput;
  };
  'chat.params': {
    input: ChatParamsInput;
    output: ChatParamsOutput;
  };
  'chat.response': {
    input: ChatResponseInput;
    output: ChatResponseOutput;
  };
  'chat.error': {
    input: ChatErrorInput;
    output: ChatErrorOutput;
  };
  'session.compacting': {
    input: SessionCompactingInput;
    output: SessionCompactingOutput;
  };
}

export type HookEventType = keyof HookMap;

export type TypedHookFunction<E extends HookEventType> = (
  input: Readonly<HookMap[E]['input']>,
  output: HookMap[E]['output']
) => Promise<void>;

export interface Hooks {
  'tool.execute.before'?: TypedHookFunction<'tool.execute.before'>;
  'tool.execute.after'?: TypedHookFunction<'tool.execute.after'>;
  'message.transform'?: TypedHookFunction<'message.transform'>;
  'system.prompt'?: TypedHookFunction<'system.prompt'>;
  'agent.step'?: TypedHookFunction<'agent.step'>;
  'agent.error'?: TypedHookFunction<'agent.error'>;
  'state.change'?: TypedHookFunction<'state.change'>;
  'agent.start'?: TypedHookFunction<'agent.start'>;
  'agent.complete'?: TypedHookFunction<'agent.complete'>;
  'llm.request.before'?: TypedHookFunction<'llm.request.before'>;
  'chat.message'?: TypedHookFunction<'chat.message'>;
  'chat.params'?: TypedHookFunction<'chat.params'>;
  'chat.response'?: TypedHookFunction<'chat.response'>;
  'chat.error'?: TypedHookFunction<'chat.error'>;
  'session.compacting'?: TypedHookFunction<'session.compacting'>;
}

export const PluginSchema = z.object({
  name: z.string().min(1, 'Plugin name is required'),
  version: z.string().optional(),
  hooks: z.record(z.string(), z.function()).optional(),
  provider: z.function().optional(),
});

export type Plugin = {
  name: string;
  version?: string;
  hooks?: Record<string, (input: unknown, output: unknown) => Promise<void>>;
  provider?: (ctx: ProviderContext) => Promise<ProviderResult>;
};
