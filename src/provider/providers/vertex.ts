import { vertex } from '@ai-sdk/google-vertex';
import type { Provider, ModelInfo } from '../types';

// ========== Vertex AI Models ==========

const VERTEX_MODELS: ModelInfo[] = [
  {
    id: 'gemini-2.0-flash',
    providerId: 'vertex',
    displayName: 'Gemini 2.0 Flash',
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
    id: 'gemini-2.0-flash-lite',
    providerId: 'vertex',
    displayName: 'Gemini 2.0 Flash Lite',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 1048576, output: 8192 },
    pricing: { input: 0.075, output: 0.3 },
  },
  {
    id: 'gemini-1.5-pro',
    providerId: 'vertex',
    displayName: 'Gemini 1.5 Pro',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 2097152, output: 8192 },
    pricing: { input: 1.25, output: 5.0 },
  },
  {
    id: 'gemini-1.5-flash',
    providerId: 'vertex',
    displayName: 'Gemini 1.5 Flash',
    capabilities: {
      toolCall: true,
      reasoning: false,
      attachment: true,
      streaming: true,
      vision: true,
    },
    limits: { context: 1048576, output: 8192 },
    pricing: { input: 0.075, output: 0.3 },
  },
];

// ========== Vertex AI Provider ==========

interface VertexConfig {
  project?: string;
  location?: string;
}

class VertexProviderImpl implements Provider {
  readonly id = 'vertex' as const;
  readonly name = 'Google Vertex AI';

  private project: string;

  constructor(config?: VertexConfig) {
    this.project = config?.project ?? process.env['GOOGLE_VERTEX_PROJECT'] ?? '';
  }

  model(modelId: string): unknown {
    // Set env var for vertex to pick up
    if (this.project) {
      process.env['GOOGLE_VERTEX_PROJECT'] = this.project;
    }
    return vertex(modelId);
  }

  async listModels(): Promise<ModelInfo[]> {
    return VERTEX_MODELS;
  }

  async getModel(modelId: string): Promise<ModelInfo | null> {
    return VERTEX_MODELS.find((m) => m.id === modelId) ?? null;
  }

  validateConfig(): boolean {
    // Vertex uses Google Application Default Credentials
    return true;
  }
}

/** Google Vertex AI provider instance */
export const vertexProvider = new VertexProviderImpl();
