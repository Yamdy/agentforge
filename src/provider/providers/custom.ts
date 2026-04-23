import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider, ModelInfo } from '../types';

// ========== Custom Provider ==========

interface CustomProviderConfig {
  baseURL: string;
  apiKey?: string;
  headers?: Record<string, string>;
  name?: string;
}

class CustomProviderImpl implements Provider {
  readonly id = 'custom' as const;
  readonly name: string;

  private config: CustomProviderConfig;
  private client: ReturnType<typeof createOpenAICompatible> | null = null;

  constructor(config: CustomProviderConfig) {
    this.config = config;
    this.name = config.name ?? 'Custom';
  }

  private getClient(): ReturnType<typeof createOpenAICompatible> {
    if (!this.client) {
      const headers: Record<string, string> = {
        ...this.config.headers,
      };
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      this.client = createOpenAICompatible({
        name: this.name.toLowerCase().replace(/\s+/g, '-'),
        baseURL: this.config.baseURL,
        headers,
      });
    }
    return this.client;
  }

  model(modelId: string): unknown {
    return this.getClient()(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    // Custom providers cannot list models
    return [];
  }

  async getModel(_modelId: string): Promise<ModelInfo | null> {
    // Custom providers cannot provide model info
    return null;
  }

  validateConfig(): boolean {
    return !!this.config.baseURL && this.config.baseURL.length > 0;
  }
}

/**
 * Create a custom provider for any OpenAI-compatible API.
 *
 * @example
 * const provider = createCustomProvider({
 *   baseURL: 'http://localhost:8080/v1',
 *   apiKey: 'my-key',
 *   name: 'My Local LLM',
 * })
 *
 * const model = provider.model('my-model')
 */
export function createCustomProvider(config: CustomProviderConfig): Provider {
  return new CustomProviderImpl(config);
}
