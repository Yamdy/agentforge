import { createAnthropic } from '@ai-sdk/anthropic';
import type { Provider, ModelInfo } from '../types';

// ========== Anthropic Models ==========

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    providerId: 'anthropic',
    displayName: 'Claude Sonnet 4',
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
    id: 'claude-3-5-sonnet-20241022',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Sonnet',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 8192 },
    pricing: { input: 3.0, output: 15.0 },
  },
  {
    id: 'claude-3-5-haiku-20241022',
    providerId: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 8192 },
    pricing: { input: 0.8, output: 4.0 },
  },
  {
    id: 'claude-3-opus-20240229',
    providerId: 'anthropic',
    displayName: 'Claude 3 Opus',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 4096 },
    pricing: { input: 15.0, output: 75.0 },
  },
  {
    id: 'claude-3-sonnet-20240229',
    providerId: 'anthropic',
    displayName: 'Claude 3 Sonnet',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 4096 },
    pricing: { input: 3.0, output: 15.0 },
    deprecated: true,
  },
];

// ========== Anthropic Provider ==========

class AnthropicProviderImpl implements Provider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic';

  private apiKey: string;
  private client: ReturnType<typeof createAnthropic> | null = null;

  constructor(config?: { apiKey?: string }) {
    this.apiKey = config?.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
  }

  private getClient(): ReturnType<typeof createAnthropic> {
    if (!this.client) {
      this.client = createAnthropic({ apiKey: this.apiKey });
    }
    return this.client;
  }

  model(modelId: string): unknown {
    return this.getClient()(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    return ANTHROPIC_MODELS.find((m) => m.id === modelId) ?? null;
  }

  validateConfig(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }
}

/** Anthropic provider instance */
export const anthropicProvider = new AnthropicProviderImpl();
