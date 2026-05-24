import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider, ModelInfo } from '../types';

// ========== OpenRouter Models (popular subset) ==========

const OPENROUTER_MODELS: ModelInfo[] = [
  {
    id: 'anthropic/claude-sonnet-4',
    providerId: 'openrouter',
    displayName: 'Claude Sonnet 4 (OpenRouter)',
    capabilities: {
      toolCall: true,
      reasoning: true,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 16000 },
    pricing: { input: 3.0, output: 15.0 },
  },
  {
    id: 'openai/gpt-4o',
    providerId: 'openrouter',
    displayName: 'GPT-4o (OpenRouter)',
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
    id: 'google/gemini-2.0-flash-001',
    providerId: 'openrouter',
    displayName: 'Gemini 2.0 Flash (OpenRouter)',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 1048576, output: 8192 },
    pricing: { input: 0.1, output: 0.4 },
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    providerId: 'openrouter',
    displayName: 'Llama 3.3 70B (OpenRouter)',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 131072, output: 8192 },
    pricing: { input: 0.39, output: 0.39 },
  },
];

// ========== OpenRouter Provider ==========

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

class OpenRouterProviderImpl implements Provider {
  readonly id = 'openrouter' as const;
  readonly name = 'OpenRouter';

  private apiKey: string;
  private client: ReturnType<typeof createOpenAICompatible> | null = null;

  constructor(config?: { apiKey?: string }) {
    this.apiKey = config?.apiKey ?? process.env['OPENROUTER_API_KEY'] ?? '';
  }

  private getClient(): ReturnType<typeof createOpenAICompatible> {
    if (!this.client) {
      this.client = createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
    }
    return this.client;
  }

  model(modelId: string): unknown {
    return this.getClient()(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return OPENROUTER_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    return OPENROUTER_MODELS.find((m) => m.id === modelId) ?? null;
  }

  validateConfig(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }
}

/** OpenRouter provider instance */
export const openrouterProvider = new OpenRouterProviderImpl();
