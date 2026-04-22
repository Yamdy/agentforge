import { Effect } from "effect";
import type { LLMProvider, LLMError, Model } from "./types";

export class RegistryError extends Error {
  readonly _tag = "RegistryError";
  constructor(readonly message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RegistryError";
  }
}

export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();

  register(provider: LLMProvider): Effect.Effect<void, RegistryError> {
    return Effect.try({
      try: () => {
        if (this.providers.has(provider.id)) {
          throw new RegistryError(`Provider with id '${provider.id}' already registered`);
        }
        this.providers.set(provider.id, provider);
      },
      catch: (e) => new RegistryError(`Failed to register provider: ${e}`, e),
    });
  }

  unregister(id: string): Effect.Effect<void, RegistryError> {
    return Effect.try({
      try: () => {
        if (!this.providers.has(id)) {
          throw new RegistryError(`Provider with id '${id}' not found`);
        }
        this.providers.delete(id);
      },
      catch: (e) => new RegistryError(`Failed to unregister provider: ${e}`, e),
    });
  }

  registerBatch(providers: LLMProvider[]): Effect.Effect<void, RegistryError> {
    return Effect.forEach(providers, (provider) => this.register(provider), {
      discard: true,
    });
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getByModel(modelId: string): LLMProvider | undefined {
    for (const provider of this.providers.values()) {
      // 简单的启发式：检查模型ID是否包含provider的标识
      if (modelId.toLowerCase().includes(provider.id.toLowerCase())) {
        return provider;
      }
    }
    return undefined;
  }

  listProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  listModels(): Effect.Effect<Model[], RegistryError> {
    return Effect.try({
      try: () => {
        const allModels: Model[] = [];
        for (const provider of this.providers.values()) {
          // 注意：这里我们不实际调用 provider.listModels() 因为它返回 Effect
          // 对于 Registry，我们只返回静态模型信息或要求用户单独调用
          // 这里我们添加一个基本的模型列表
          allModels.push({
            id: `${provider.id}-default`,
            name: `${provider.name} Default`,
            provider: provider.id,
            contextWindow: 128000,
            supportsFunctionCalling: provider.supportsFunctionCalling,
            supportsVision: false,
          });
        }
        return allModels;
      },
      catch: (e) => new RegistryError(`Failed to list models: ${e}`, e),
    });
  }

  listModelsByProvider(providerId: string): Effect.Effect<Model[], RegistryError> {
    return Effect.try({
      try: () => {
        const provider = this.providers.get(providerId);
        if (!provider) {
          throw new RegistryError(`Provider with id '${providerId}' not found`);
        }
        // 返回基本模型信息，不调用 provider.listModels()
        return [
          {
            id: `${provider.id}-default`,
            name: `${provider.name} Default`,
            provider: provider.id,
            contextWindow: 128000,
            supportsFunctionCalling: provider.supportsFunctionCalling,
            supportsVision: false,
          },
        ];
      },
      catch: (e) => new RegistryError(`Failed to list models for provider: ${e}`, e),
    });
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  size(): number {
    return this.providers.size;
  }

  clear(): void {
    this.providers.clear();
  }
}

export const PROVIDER_IDS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  AZURE_OPENAI: "azure-openai",
  BEDROCK: "bedrock",
  OPENAI_COMPATIBLE: "openai-compatible",
} as const;
