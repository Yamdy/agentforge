import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider, ModelInfo } from '../types';

// ========== Ollama Models (common local models) ==========

const OLLAMA_MODELS: ModelInfo[] = [
  {
    id: 'llama3.2',
    providerId: 'ollama',
    displayName: 'Llama 3.2 (Ollama)',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 131072, output: 8192 },
    pricing: { input: 0, output: 0 }, // Free local
  },
  {
    id: 'llama3.1',
    providerId: 'ollama',
    displayName: 'Llama 3.1 (Ollama)',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: false,
    },
    limits: { context: 131072, output: 8192 },
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'qwen2.5',
    providerId: 'ollama',
    displayName: 'Qwen 2.5 (Ollama)',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 131072, output: 8192 },
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'deepseek-r1',
    providerId: 'ollama',
    displayName: 'DeepSeek R1 (Ollama)',
    capabilities: {
      toolCall: false,
      reasoning: true,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 131072, output: 8192 },
    pricing: { input: 0, output: 0 },
  },
  {
    id: 'codellama',
    providerId: 'ollama',
    displayName: 'Code Llama (Ollama)',
    capabilities: {
      toolCall: false,
      reasoning: false,
      attachment: false,
      streaming: true,
      vision: false,
    },
    limits: { context: 16384, output: 4096 },
    pricing: { input: 0, output: 0 },
  },
];

// ========== Ollama Provider ==========

interface OllamaConfig {
  baseURL?: string;
}

const DEFAULT_OLLAMA_URL = 'http://localhost:11434/v1';

class OllamaProviderImpl implements Provider {
  readonly id = 'ollama' as const;
  readonly name = 'Ollama';

  private baseURL: string;
  private client: ReturnType<typeof createOpenAICompatible> | null = null;

  constructor(config?: OllamaConfig) {
    this.baseURL = config?.baseURL ?? process.env['OLLAMA_BASE_URL'] ?? DEFAULT_OLLAMA_URL;
  }

  private getClient(): ReturnType<typeof createOpenAICompatible> {
    if (!this.client) {
      this.client = createOpenAICompatible({
        name: 'ollama',
        baseURL: this.baseURL,
      });
    }
    return this.client;
  }

  model(modelId: string): unknown {
    return this.getClient()(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return OLLAMA_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    return OLLAMA_MODELS.find((m) => m.id === modelId) ?? null;
  }

  validateConfig(): boolean {
    // Ollama is always valid (local, no auth required)
    return true;
  }
}

/** Ollama provider instance */
export const ollamaProvider = new OllamaProviderImpl();
