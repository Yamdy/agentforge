// ========== Provider instances ==========
export { anthropicProvider } from './providers/anthropic.js';
export { openaiProvider } from './providers/openai.js';
export { azureProvider } from './providers/azure.js';
export { bedrockProvider } from './providers/bedrock.js';
export { vertexProvider } from './providers/vertex.js';
export { openrouterProvider } from './providers/openrouter.js';
export { ollamaProvider } from './providers/ollama.js';
export { createCustomProvider } from './providers/custom.js';

// ========== Registry ==========
export { providerRegistry } from './registry.js';

// ========== Types ==========
export type {
  ProviderConfig,
  ProviderType,
  ModelInfo,
  ModelCapabilities,
  ModelLimits,
  ModelPricing,
  ModelInstance,
} from './types.js';

// Re-export Provider interface with a different name to avoid conflict
export type { Provider as ProviderInterface } from './types.js';

// ========== Convenience API ==========

import { providerRegistry } from './registry.js';
import { anthropicProvider } from './providers/anthropic.js';
import { openaiProvider } from './providers/openai.js';
import { azureProvider } from './providers/azure.js';
import { bedrockProvider } from './providers/bedrock.js';
import { vertexProvider } from './providers/vertex.js';
import { openrouterProvider } from './providers/openrouter.js';
import { ollamaProvider } from './providers/ollama.js';
import type { ProviderType, ModelInfo } from './types.js';

// Auto-register all built-in providers
providerRegistry.register(anthropicProvider);
providerRegistry.register(openaiProvider);
providerRegistry.register(azureProvider);
providerRegistry.register(bedrockProvider);
providerRegistry.register(vertexProvider);
providerRegistry.register(openrouterProvider);
providerRegistry.register(ollamaProvider);

/**
 * Convenience API for Provider system.
 *
 * @example
 * // Create a model instance
 * const model = Provider.model('anthropic', 'claude-sonnet-4')
 *
 * // List available providers
 * const providers = Provider.list()
 *
 * // Search for a model
 * const info = await Provider.findModel('claude')
 */
const ProviderAPI = {
  /**
   * Create a LanguageModelV1 instance from provider + model ID.
   *
   * @example
   * const model = Provider.model('anthropic', 'claude-sonnet-4')
   * const model = Provider.model('openai', 'gpt-4o')
   * const model = Provider.model('ollama', 'llama3.2')
   */
  model(providerId: ProviderType | string, modelId: string) {
    return providerRegistry.getModel(providerId as ProviderType, modelId);
  },

  /**
   * List all registered providers.
   */
  list() {
    return providerRegistry.list();
  },

  /**
   * Get a specific provider by ID.
   */
  get(id: ProviderType | string) {
    return providerRegistry.get(id as ProviderType);
  },

  /**
   * Search for a model across all providers.
   */
  async findModel(query: string): Promise<ModelInfo | null> {
    return providerRegistry.findModel(query);
  },

  /**
   * List all models across all providers.
   */
  async listModels(): Promise<ModelInfo[]> {
    return providerRegistry.listAllModels();
  },

  /**
   * Refresh model cache from all providers.
   */
  async refreshModels(): Promise<void> {
    return providerRegistry.refreshModels();
  },
} as const;

export { ProviderAPI as Provider };
