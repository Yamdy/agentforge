// ========== Provider Types ==========

export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'azure'
  | 'bedrock'
  | 'vertex'
  | 'openrouter'
  | 'ollama'
  | 'custom';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  headers?: Record<string, string>;
  customOptions?: Record<string, unknown>;
}

// ========== Model Types ==========

export interface ModelInfo {
  id: string;
  providerId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  pricing: ModelPricing;
  deprecated?: boolean;
}

export interface ModelCapabilities {
  toolCall: boolean;
  reasoning: boolean;
  attachment: boolean;
  streaming: boolean;
  vision: boolean;
}

export interface ModelLimits {
  context: number;
  output: number;
}

export interface ModelPricing {
  input: number;
  output: number;
  cache?: number;
}

// ========== Provider Interface ==========

export interface Provider {
  readonly id: ProviderType;
  readonly name: string;

  /** Create a language model instance for the given model ID */
  model(modelId: string): unknown;

  /** List available models for this provider */
  listModels(): Promise<ModelInfo[]>;

  /** Get info for a specific model */
  getModel(modelId: string): Promise<ModelInfo | null>;

  /** Check if the provider is properly configured */
  validateConfig(): boolean;

  /** Provider-specific initialization */
  init?(): Promise<void>;
}

// ========== Model Instance ==========

export interface ModelInstance {
  readonly providerId: string;
  readonly modelId: string;
  readonly info: ModelInfo;
}
