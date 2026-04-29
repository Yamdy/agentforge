/**
 * AgentForge Semantic Memory Manager
 *
 * Combines embedding model with vector store for semantic memory.
 * Provides save, search, and prompt injection capabilities.
 *
 * @module
 */

import type { EmbeddingModel } from './embedding.js';
import type { VectorStore, VectorDocument } from './vector-store.js';
import type { MemoryEntry } from './types.js';
import { createEmbeddingModel } from './embedding.js';

// ============================================================
// Configuration
// ============================================================

/**
 * Semantic Memory Configuration
 */
export interface SemanticMemoryConfig {
  /** Embedding model */
  embeddingModel: EmbeddingModel;

  /** Vector store */
  vectorStore: VectorStore;

  /** Default search limit */
  defaultLimit?: number;

  /** Default similarity threshold */
  defaultThreshold?: number;
}

// ============================================================
// Semantic Memory Manager
// ============================================================

/**
 * Semantic Memory Manager
 *
 * Provides semantic search over stored memories using vector embeddings.
 */
export class SemanticMemory {
  private _embeddingModel: EmbeddingModel;
  private vectorStore: VectorStore;
  private defaultLimit: number;
  private defaultThreshold: number;

  constructor(config: SemanticMemoryConfig) {
    this._embeddingModel = config.embeddingModel;
    this.vectorStore = config.vectorStore;
    this.defaultLimit = config.defaultLimit ?? 5;
    this.defaultThreshold = config.defaultThreshold ?? 0.7;
  }

  /** Get embedding model for external use */
  get embeddingModel(): EmbeddingModel {
    return this._embeddingModel;
  }

  /**
   * Save a memory entry
   *
   * Generates embedding via the embedding model and stores in vector database.
   */
  async save(entry: MemoryEntry): Promise<void> {
    // Generate real embedding from content
    const embedding = await this._embeddingModel.embed(entry.content);

    const doc: VectorDocument = {
      id: entry.id,
      embedding,
      content: entry.content,
      metadata: {
        sourcePath: entry.sourcePath,
        tags: entry.tags,
      },
      createdAt: entry.createdAt,
    };

    this.vectorStore.insert(doc);
  }

  /**
   * Search memories by semantic similarity
   *
   * @param query - Search query
   * @param limit - Max results
   * @param threshold - Min similarity score
   * @returns Matching memory entries
   */
  async search(query: string, limit?: number, threshold?: number): Promise<MemoryEntry[]> {
    // Generate real embedding from query
    const queryEmbedding = await this._embeddingModel.embed(query);

    const results = this.vectorStore.search(
      queryEmbedding,
      limit ?? this.defaultLimit,
      threshold ?? this.defaultThreshold
    );

    return results.map(r => {
      const tags = r.document.metadata?.tags as string[] | undefined;
      const entry: MemoryEntry = {
        id: r.document.id,
        content: r.document.content,
        sourcePath: (r.document.metadata?.sourcePath as string) ?? '',
        createdAt: r.document.createdAt,
        updatedAt: r.document.createdAt,
      };
      if (tags) entry.tags = tags;
      return entry;
    });
  }

  /**
   * Format search results for system prompt injection
   */
  formatForPrompt(entries: MemoryEntry[]): string {
    if (entries.length === 0) return '';

    const lines = entries.map((e, i) => `[${i + 1}] ${e.content}`);
    return `## Relevant Memories\n\n${lines.join('\n\n')}`;
  }

  /**
   * Get memory by ID
   */
  get(id: string): MemoryEntry | null {
    const doc = this.vectorStore.get(id);
    if (!doc) return null;

    const tags = doc.metadata?.tags as string[] | undefined;
    const entry: MemoryEntry = {
      id: doc.id,
      content: doc.content,
      sourcePath: (doc.metadata?.sourcePath as string) ?? '',
      createdAt: doc.createdAt,
      updatedAt: doc.createdAt,
    };
    if (tags) entry.tags = tags;
    return entry;
  }

  /**
   * Delete memory by ID
   */
  delete(id: string): void {
    this.vectorStore.delete(id);
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.vectorStore.clear();
  }

  /**
   * Get memory count
   */
  count(): number {
    return this.vectorStore.count();
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create semantic memory with default config
 */
export function createSemanticMemory(config: {
  embeddingProvider: 'openai' | 'google';
  vectorStore: VectorStore;
  embeddingOptions?: { apiKey?: string; model?: string };
}): SemanticMemory {
  const embeddingModel = createEmbeddingModel(config.embeddingProvider, config.embeddingOptions);

  return new SemanticMemory({
    embeddingModel,
    vectorStore: config.vectorStore,
  });
}
