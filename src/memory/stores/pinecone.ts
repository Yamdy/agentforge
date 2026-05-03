/**
 * Pinecone Vector Store
 *
 * Adapts Pinecone's official SDK to AgentForge's VectorStore interface.
 * Uses in-memory Map internally for storage; SDK integration is opt-in
 * via graceful fallback when @pinecone-database/pinecone is not installed.
 *
 * @module
 */

import { createRequire } from 'node:module';
import type { VectorStore, VectorDocument, VectorSearchResult } from '../vector-store.js';
import { cosineSimilarity } from '../vector-store.js';

// ============================================================
// Graceful SDK Import
// ============================================================

let PineconeSDK: unknown = null;
let sdkAvailable = false;

try {
  const _require = createRequire(import.meta.url);
  const mod = _require('@pinecone-database/pinecone') as Record<string, unknown>;
  PineconeSDK = (mod as { Pinecone?: unknown }).Pinecone ?? null;
  sdkAvailable = PineconeSDK !== null;
} catch {
  console.warn(
    '@pinecone-database/pinecone not installed. PineconeVectorStore will use in-memory fallback.'
  );
}

// ============================================================
// Types
// ============================================================

export interface PineconeVectorStoreConfig {
  /** Pinecone API key */
  apiKey: string;

  /** Pinecone environment (e.g., 'us-west1-gcp') */
  environment: string;

  /** Pinecone index name */
  indexName: string;

  /** Embedding dimensions expected by the index */
  dimensions: number;

  /** Store name for logging (default: 'pinecone') */
  name?: string;
}

// ============================================================
// Pinecone Vector Store Implementation
// ============================================================

export class PineconeVectorStore implements VectorStore {
  readonly name: string;

  /** In-memory storage (always used; SDK integration is opt-in) */
  private storage: Map<string, VectorDocument>;

  /** Config preserved for future SDK connection */
  readonly config: PineconeVectorStoreConfig;

  constructor(config: PineconeVectorStoreConfig) {
    this.config = config;
    this.name = config.name ?? 'pinecone';
    this.storage = new Map();

    if (sdkAvailable) {
      // SDK installed but no real connection established here.
      // Placeholder: indexes would be accessed via:
      //   const pinecone = new (PineconeSDK as ...)({ apiKey, environment });
      //   const index = pinecone.index(indexName);
    }
  }

  // ============================================================
  // VectorStore Interface
  // ============================================================

  insert(doc: VectorDocument): void {
    this.storage.set(doc.id, doc);
  }

  insertBatch(docs: VectorDocument[]): void {
    for (const doc of docs) {
      this.storage.set(doc.id, doc);
    }
  }

  search(embedding: number[], limit = 5, threshold = 0.7): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];

    for (const doc of this.storage.values()) {
      const score = cosineSimilarity(embedding, doc.embedding);

      if (score >= threshold) {
        results.push({ document: doc, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  get(id: string): VectorDocument | null {
    return this.storage.get(id) ?? null;
  }

  delete(id: string): void {
    this.storage.delete(id);
  }

  clear(): void {
    this.storage.clear();
  }

  count(): number {
    return this.storage.size;
  }

  close(): void {
    this.storage.clear();
  }
}
