import { openai } from '@ai-sdk/openai';
import type { Provider, ModelInfo } from '../types';

// ========== OpenAI Models ==========

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: 'gpt-4o',
    providerId: 'openai',
    displayName: 'GPT-4o',
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
    providerId: 'openai',
    displayName: 'GPT-4o Mini',
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
    providerId: 'openai',
    displayName: 'GPT-4 Turbo',
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
  {
    id: 'gpt-4',
    providerId: 'openai',
    displayName: 'GPT-4',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 8192, output: 4096 },
    pricing: { input: 30.0, output: 60.0 },
  },
  {
    id: 'gpt-3.5-turbo',
    providerId: 'openai',
    displayName: 'GPT-3.5 Turbo',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 16385, output: 4096 },
    pricing: { input: 0.5, output: 1.5 },
  },
  {
    id: 'o1-preview',
    providerId: 'openai',
    displayName: 'o1 Preview',
    capabilities: {
      toolCall: false,
      reasoning: true,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 128000, output: 32768 },
    pricing: { input: 15.0, output: 60.0 },
  },
  {
    id: 'o1-mini',
    providerId: 'openai',
    displayName: 'o1 Mini',
    capabilities: {
      toolCall: false,
      reasoning: true,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 128000, output: 65536 },
    pricing: { input: 3.0, output: 12.0 },
  },
];

// ========== OpenAI Provider ==========

class OpenAIProviderImpl implements Provider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';

  private apiKey: string;
  private baseURL: string | undefined;

  constructor(config?: { apiKey?: string; baseURL?: string }) {
    this.apiKey = config?.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.baseURL = config?.baseURL ?? process.env['OPENAI_BASE_URL'];
  }

  model(modelId: string): unknown {
    // Set env vars for openai() to pick up
    if (this.apiKey) {
      process.env['OPENAI_API_KEY'] = this.apiKey;
    }
    if (this.baseURL) {
      process.env['OPENAI_BASE_URL'] = this.baseURL;
    }
    return openai(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return OPENAI_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    return OPENAI_MODELS.find((m) => m.id === modelId) ?? null;
  }

  validateConfig(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }
}

/** OpenAI provider instance */
export const openaiProvider = new OpenAIProviderImpl();
