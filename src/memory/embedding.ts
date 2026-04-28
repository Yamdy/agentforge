/**
 * AgentForge Embedding Model Interface
 *
 * Abstracts embedding generation for different providers.
 * Used by SemanticMemory for vector search.
 *
 * @module
 */

// ============================================================
// Embedding Model Interface
// ============================================================

/**
 * Embedding Model Interface
 */
export interface EmbeddingModel {
  /** Provider name (e.g., 'openai', 'google') */
  readonly provider: string;

  /** Model name (e.g., 'text-embedding-3-small') */
  readonly model: string;

  /** Embedding dimensions (e.g., 1536 for text-embedding-3-small) */
  readonly dimensions: number;

  /**
   * Generate embedding for a single text
   *
   * @param text - Text to embed
   * @returns Embedding vector
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts (batch)
   *
   * @param texts - Texts to embed
   * @returns Embedding vectors
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * Embedding Model Options
 */
export interface EmbeddingModelOptions {
  /** API key */
  apiKey?: string;

  /** Model name override */
  model?: string;

  /** Dimensions override */
  dimensions?: number;
}

// ============================================================
// OpenAI Embedding Model
// ============================================================

/**
 * OpenAI Embedding Model
 *
 * Uses text-embedding-3-small (1536 dims) or text-embedding-3-large (3072 dims)
 */
export class OpenAIEmbeddingModel implements EmbeddingModel {
  readonly provider = 'openai';
  readonly model: string;
  readonly dimensions: number;

  private apiKey: string;

  constructor(options?: EmbeddingModelOptions) {
    this.apiKey = options?.apiKey ?? process.env['OPENAI_API_KEY'] ?? '';
    this.model = options?.model ?? 'text-embedding-3-small';
    this.dimensions = options?.dimensions ?? (this.model.includes('large') ? 3072 : 1536);

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required for OpenAI embedding model');
    }
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data[0]?.embedding ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map(d => d.embedding);
  }
}

// ============================================================
// Google Embedding Model
// ============================================================

/**
 * Google Embedding Model
 *
 * Uses text-embedding-004 (768 dims)
 */
export class GoogleEmbeddingModel implements EmbeddingModel {
  readonly provider = 'google';
  readonly model: string;
  readonly dimensions: number;

  private apiKey: string;

  constructor(options?: EmbeddingModelOptions) {
    this.apiKey = options?.apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
    this.model = options?.model ?? 'text-embedding-004';
    this.dimensions = options?.dimensions ?? 768;

    if (!this.apiKey) {
      throw new Error('GOOGLE_API_KEY is required for Google embedding model');
    }
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) {
      throw new Error(`Google embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      embedding: { values: number[] };
    };

    return data.embedding.values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map(text => ({
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      throw new Error(`Google batch embedding error: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      embeddings: Array<{ values: number[] }>;
    };

    return data.embeddings.map(e => e.values);
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create embedding model by provider name
 */
export function createEmbeddingModel(
  provider: 'openai' | 'google',
  options?: EmbeddingModelOptions
): EmbeddingModel {
  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingModel(options);
    case 'google':
      return new GoogleEmbeddingModel(options);
    default: {
      throw new Error(`Unknown embedding provider: ${String(provider)}`);
    }
  }
}
