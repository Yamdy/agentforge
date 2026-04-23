import { bedrock } from '@ai-sdk/amazon-bedrock';
import type { Provider, ModelInfo } from '../types';

// ========== Bedrock Models ==========

const BEDROCK_MODELS: ModelInfo[] = [
  {
    id: 'anthropic.claude-sonnet-4-20250514-v1:0',
    providerId: 'bedrock',
    displayName: 'Bedrock Claude Sonnet 4',
    capabilities: {
      toolCall: true,
      reasoning: true,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 200000, output: 8192 },
    pricing: { input: 3.0, output: 15.0 },
  },
  {
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    providerId: 'bedrock',
    displayName: 'Bedrock Claude 3.5 Sonnet v2',
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
    id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
    providerId: 'bedrock',
    displayName: 'Bedrock Claude 3.5 Haiku',
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
];

// ========== Bedrock Provider ==========

/** Cross-region inference prefixes */
const CROSS_REGION_PREFIXES = ['us.', 'eu.', 'global.', 'apac.'] as const;

class BedrockProviderImpl implements Provider {
  readonly id = 'bedrock' as const;
  readonly name = 'AWS Bedrock';

  private region: string;

  constructor(config?: { region?: string }) {
    this.region = config?.region ?? process.env['AWS_REGION'] ?? 'us-east-1';
  }

  /**
   * Parse model ID, handling cross-region inference prefixes.
   * e.g. "us.anthropic.claude-3-5-sonnet" → model "anthropic.claude-3-5-sonnet"
   */
  private parseModelId(modelId: string): string {
    for (const prefix of CROSS_REGION_PREFIXES) {
      if (modelId.startsWith(prefix)) {
        return modelId.slice(prefix.length);
      }
    }
    return modelId;
  }

  model(modelId: string): unknown {
    const parsedId = this.parseModelId(modelId);
    return bedrock(parsedId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return BEDROCK_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    const parsedId = this.parseModelId(modelId);
    return BEDROCK_MODELS.find((m) => m.id === parsedId) ?? null;
  }

  validateConfig(): boolean {
    // Bedrock uses AWS credential chain (env vars, IAM role, etc.)
    // We check for region at minimum
    return !!this.region && this.region.length > 0;
  }
}

/** AWS Bedrock provider instance */
export const bedrockProvider = new BedrockProviderImpl();
