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

export type HookEvent = typeof HookEvents[keyof typeof HookEvents];

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

export interface MessageTransformInput {}
export interface MessageTransformOutput {
  messages: Record<string, unknown>[];
}

export interface SystemPromptInput {}
export interface SystemPromptOutput {
  prompt: string[];
}

export interface AgentStepInput {
  step: number;
  maxSteps: number;
}
export interface AgentStepOutput {}

export interface AgentErrorInput {
  error: string;
}
export interface AgentErrorOutput {}

export interface StateChangeInput {
  from: TaskStatus;
  to: TaskStatus;
}
export interface StateChangeOutput {}

export interface AgentStartInput {
  userInput: string;
}
export interface AgentStartOutput {}

export interface AgentCompleteInput {
  userInput: string;
  response: string;
}
export interface AgentCompleteOutput {}

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

export interface ChatResponseOutput {}

export interface ChatErrorInput {
  sessionId?: string;
  error: Error;
  duration: number;
}

export interface ChatErrorOutput {}

export interface SessionCompactingInput {
  sessionId?: string;
  messageCount: number;
}

export interface SessionCompactingOutput {
  context: string[];
  prompt?: string;
}

export interface Hooks {
  'tool.execute.before'?: (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
  'tool.execute.after'?: (input: ToolExecuteAfterInput, output: ToolExecuteAfterOutput) => Promise<void>;
  'message.transform'?: (input: MessageTransformInput, output: MessageTransformOutput) => Promise<void>;
  'system.prompt'?: (input: SystemPromptInput, output: SystemPromptOutput) => Promise<void>;
  'agent.step'?: (input: AgentStepInput, output: AgentStepOutput) => Promise<void>;
  'agent.error'?: (input: AgentErrorInput, output: AgentErrorOutput) => Promise<void>;
  'state.change'?: (input: StateChangeInput, output: StateChangeOutput) => Promise<void>;
  'agent.start'?: (input: AgentStartInput, output: AgentStartOutput) => Promise<void>;
  'agent.complete'?: (input: AgentCompleteInput, output: AgentCompleteOutput) => Promise<void>;
  'llm.request.before'?: (input: LLMRequestBeforeInput, output: LLMRequestBeforeOutput) => Promise<void>;
  'chat.message'?: (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
  'chat.params'?: (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void>;
  'chat.response'?: (input: ChatResponseInput, output: ChatResponseOutput) => Promise<void>;
  'chat.error'?: (input: ChatErrorInput, output: ChatErrorOutput) => Promise<void>;
  'session.compacting'?: (input: SessionCompactingInput, output: SessionCompactingOutput) => Promise<void>;
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
