import type { Provider, ProviderType, ModelInfo } from './types';

// ========== Provider Registry ==========

class ProviderRegistry {
  private providers: Map<ProviderType, Provider> = new Map();
  private allModels: ModelInfo[] = [];
  private modelsLoaded = false;
  private modelsCacheTTL = 5 * 60 * 1000; // 5 minutes
  private modelsCacheTimestamp = 0;

  /** Register a provider */
  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  /** Get a provider by ID */
  get(id: ProviderType): Provider | undefined {
    return this.providers.get(id);
  }

  /** List all registered providers */
  list(): Provider[] {
    return Array.from(this.providers.values());
  }

  /** Create a LanguageModelV1 from provider + model ID */
  createModel(providerId: ProviderType, modelId: string): Provider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(
        `Provider not found: "${providerId}". Available: ${Array.from(this.providers.keys()).join(', ')}`
      );
    }
    return provider;
  }

  /** Get a model instance (LanguageModelV1) from provider + model ID */
  getModel(providerId: ProviderType, modelId: string): unknown {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(
        `Provider not found: "${providerId}". Available: ${Array.from(this.providers.keys()).join(', ')}`
      );
    }
    if (!provider.validateConfig()) {
      throw new Error(
        `Provider "${providerId}" is not properly configured. Check API keys and settings.`
      );
    }
    return provider.model(modelId);
  }

  /** Search for a model across all providers */
  async findModel(query: string): Promise<ModelInfo | null> {
    await this.ensureModelsLoaded();
    const lowerQuery = query.toLowerCase();
    const match = this.allModels.find(
      (m) =>
        m.id.toLowerCase() === lowerQuery ||
        m.id.toLowerCase().includes(lowerQuery) ||
        m.displayName.toLowerCase().includes(lowerQuery)
    );
    return match ?? null;
  }

  /** List all models across all providers */
  async listAllModels(): Promise<ModelInfo[]> {
    await this.ensureModelsLoaded();
    return [...this.allModels];
  }

  /** Refresh model cache from all providers */
  async refreshModels(): Promise<void> {
    const modelLists = await Promise.allSettled(
      Array.from(this.providers.values()).map((p) => p.listModels())
    );

    const models: ModelInfo[] = [];
    for (const result of modelLists) {
      if (result.status === 'fulfilled') {
        models.push(...result.value);
      }
    }

    this.allModels = models;
    this.modelsLoaded = true;
    this.modelsCacheTimestamp = Date.now();
  }

  private async ensureModelsLoaded(): Promise<void> {
    const isCacheExpired =
      Date.now() - this.modelsCacheTimestamp > this.modelsCacheTTL;

    if (!this.modelsLoaded || isCacheExpired) {
      await this.refreshModels();
    }
  }
}

/** Global provider registry singleton */
export const providerRegistry = new ProviderRegistry();
