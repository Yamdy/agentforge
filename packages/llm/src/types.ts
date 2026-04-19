import type { Effect } from "effect";
import { type Message, type Tool } from "@agentforge/core";

export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMGenerateParams {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: Array<Tool>;
}

export interface LLMGenerateResult {
  text: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface LLMProvider {
  generate: (params: LLMGenerateParams) => Effect.Effect<LLMGenerateResult, LLMError>;
}

export class LLMError {
  readonly _tag = "LLMError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export type StreamEvent =
  | { type: "text-delta"; content: string }
  | { type: "tool-call-start"; toolCallId: string; toolName: string }
  | { type: "done"; text: string; toolCalls?: Array<{ id: string; name: string; parameters: Record<string, unknown> }> };

export interface LLMStreamProvider {
  generateStream: (
    params: LLMGenerateParams
  ) => Effect.Effect<AsyncIterable<StreamEvent>, LLMError>;
}
