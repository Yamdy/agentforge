import { Effect } from "effect";
import type { Message } from "@agentforge/core";
import type {
  LLMProvider,
  LLMGenerateParams,
  LLMError,
  LLMConfig,
  StreamEvent,
  LLMStreamProvider,
  LLMGenerateResult,
  Model as ProviderModel,
} from "../types";
import { OpenAICompatibleProvider } from "../provider";

const OPENAI_MODELS: ProviderModel[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    contextWindow: 128000,
    supportsFunctionCalling: true,
    supportsVision: true,
    inputCostPer1kTokens: 0.005,
    outputCostPer1kTokens: 0.015,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    contextWindow: 128000,
    supportsFunctionCalling: true,
    supportsVision: false,
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
  },
  {
    id: "gpt-4-turbo",
    name: "GPT-4 Turbo",
    provider: "openai",
    contextWindow: 128000,
    supportsFunctionCalling: true,
    supportsVision: false,
    inputCostPer1kTokens: 0.01,
    outputCostPer1kTokens: 0.03,
  },
  {
    id: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo",
    provider: "openai",
    contextWindow: 16384,
    supportsFunctionCalling: true,
    supportsVision: false,
    inputCostPer1kTokens: 0.0015,
    outputCostPer1kTokens: 0.002,
  },
];

export class OpenAIProvider implements LLMStreamProvider {
  readonly id = "openai";
  readonly name = "OpenAI";
  readonly supportsStream = true;
  readonly supportsFunctionCalling = true;

  private readonly compatibleProvider: OpenAICompatibleProvider;

  constructor(config: LLMConfig) {
    const openAIConfig: LLMConfig = {
      ...config,
      baseURL: config.baseURL || "https://api.openai.com/v1",
    };
    this.compatibleProvider = new OpenAICompatibleProvider(openAIConfig);
  }

  generate(params: LLMGenerateParams): Effect.Effect<LLMGenerateResult, LLMError> {
    return this.compatibleProvider.generate(params);
  }

  generateStream(
    params: LLMGenerateParams
  ): Effect.Effect<AsyncIterable<StreamEvent>, LLMError> {
    return this.compatibleProvider.generateStream(params);
  }

  listModels(): Effect.Effect<ProviderModel[], LLMError> {
    return Effect.succeed(OPENAI_MODELS);
  }

  validateKey(): Effect.Effect<void, LLMError> {
    return this.compatibleProvider.validateKey();
  }
}
