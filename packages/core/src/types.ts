import { z } from 'zod';

// ─── Recursive JSON value ───────────────────────────────────────────

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

// ─── Core Agent Types ───────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  error?: string;
}

export interface ToolDef<TParams extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: TParams;
  execute: (params: z.infer<TParams>) => Promise<JSONValue>;
}

export interface LLMRequest {
  messages: Message[];
  tools?: ToolDef[];
  providerOptions?: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export type CompletedToolCall = ToolCall & { result: ToolResult };

// ─── Event System ───────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'llm_request'; request: LLMRequest }
  | { type: 'llm_response'; response: LLMResponse }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_end'; toolCall: ToolCall; result: ToolResult }
  | { type: 'agent_error'; error: string }
  | { type: 'done'; reason: 'stop' | 'error' };

// ─── Run Interface ──────────────────────────────────────────────────

export interface RunHandlers {
  onEvent?: (event: AgentEvent) => void;
  onToken?: (token: string) => void;
}

export interface RunResult {
  text: string;
  toolCalls: CompletedToolCall[];
  finishReason: 'stop' | 'error';
}

// ─── LLM Adapter ────────────────────────────────────────────────────

export interface LLMAdapter {
  chat(request: LLMRequest): Promise<LLMResponse>;
  maxContextWindow: number;
}

// ─── Plugin System ──────────────────────────────────────────────────

export interface Plugin {
  name: string;
  transformRequest?(request: LLMRequest): LLMRequest | Promise<LLMRequest>;
  beforeLLM?(request: LLMRequest): LLMRequest | false | Promise<LLMRequest | false>;
  afterLLM?(
    response: LLMResponse,
    request: LLMRequest,
  ): LLMResponse | null | Promise<LLMResponse | null>;
  beforeToolCall?(
    tc: ToolCall,
  ): ToolCall | null | false | Promise<ToolCall | null | false>;
  afterToolCall?(
    result: ToolResult,
    tc: ToolCall,
  ): ToolResult | null | Promise<ToolResult | null>;
}

// ─── Agent (functional core) ────────────────────────────────────────

export type Agent = (input: string, handlers?: RunHandlers) => Promise<RunResult>;
