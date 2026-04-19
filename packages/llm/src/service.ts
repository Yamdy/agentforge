import type { Effect } from "effect";
import type { Message, Tool } from "@agentforge/core";
import {
  LLMConfig,
  LLMGenerateResult,
  StreamEvent,
  LLMError,
} from "./types";
import { OpenAICompatibleProvider } from "./provider";

export interface LLMService {
  readonly generate: (
    params: {
      messages: Message[];
      tools?: Array<Tool>;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ) => Effect.Effect<LLMGenerateResult, LLMError>;

  readonly generateStream: (
    params: {
      messages: Message[];
      tools?: Array<Tool>;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ) => Effect.Effect<AsyncIterable<StreamEvent>, LLMError>;
}

export class OpenAICompatibleService implements LLMService {
  private readonly provider: OpenAICompatibleProvider;

  constructor(config: LLMConfig) {
    this.provider = new OpenAICompatibleProvider(config);
  }

  generate(params: {
    messages: Message[];
    tools?: Array<Tool>;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }): Effect.Effect<LLMGenerateResult, LLMError> {
    return this.provider.generate(params);
  }

  generateStream(params: {
    messages: Message[];
    tools?: Array<Tool>;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }): Effect.Effect<AsyncIterable<StreamEvent>, LLMError> {
    return this.provider.generateStream(params);
  }
}