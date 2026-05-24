import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider, ModelInfo } from '../types';

// ========== Azure OpenAI Models ==========

const AZURE_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    providerId: 'azure',
    displayName: 'Azure GPT-4o',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 128000, output: 16384 },
    pricing: { input: 2.5, output: 10.0 },
  },
  {
    id: 'gpt-4o-mini',
    providerId: 'azure',
    displayName: 'Azure GPT-4o Mini',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 128000, output: 16384 },
    pricing: { input: 0.15, output: 0.6 },
  },
  {
    id: 'gpt-4-turbo',
    providerId: 'azure',
    displayName: 'Azure GPT-4 Turbo',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 128000, output: 4096 },
    pricing: { input: 10.0, output: 30.0 },
  },
];

// ========== Azure Provider ==========

interface AzureConfig {
  resourceName?: string;
  apiKey?: string;
  apiVersion?: string;
}

class AzureProviderImpl implements Provider {
  readonly id = 'azure' as const;
  readonly name = 'Azure OpenAI';

  private resourceName: string;
  private apiKey: string;
  private apiVersion: string;

  constructor(config?: AzureConfig) {
    this.resourceName =
      config?.resourceName ?? process.env['AZURE_OPENAI_RESOURCE_NAME'] ?? '';
    this.apiKey = config?.apiKey ?? process.env['AZURE_OPENAI_API_KEY'] ?? '';
    this.apiVersion = config?.apiVersion ?? process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-12-01-preview';
  }

  private getBaseURL(): string {
    return `https://${this.resourceName}.openai.azure.com/openai/deployments`;
  }

  model(modelId: string): unknown {
    const baseURL = `${this.getBaseURL()}/${modelId}`;
    
    return createOpenAICompatible({
      name: 'azure',
      baseURL,
      headers: {
        'api-key': this.apiKey,
      },
      fetch: async (url, init) => {
        // Azure requires api-version query param
        const urlWithVersion = url.toString().includes('?')
          ? `${url}&api-version=${this.apiVersion}`
          : `${url}?api-version=${this.apiVersion}`;
        return fetch(urlWithVersion, init);
      },
    })(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return AZURE_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    return AZURE_MODELS.find((m) => m.id === modelId) ?? null;
  }

  validateConfig(): boolean {
    return (
      !!this.resourceName &&
      this.resourceName.length > 0 &&
      !!this.apiKey &&
      this.apiKey.length > 0
    );
  }
}

/** Azure OpenAI provider instance */
export const azureProvider = new AzureProviderImpl();
