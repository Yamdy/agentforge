import { Effect } from "effect";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

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
}

export interface LLMProvider {
  generate: (params: LLMGenerateParams) => Effect.Effect<string, LLMError>;
}

export class LLMError {
  readonly _tag = "LLMError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}
