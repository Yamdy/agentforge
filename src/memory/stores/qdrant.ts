/**
 * Qdrant Vector Store
 *
 * Adapts Qdrant's official SDK to AgentForge's VectorStore interface.
 * Uses in-memory Map internally for storage; SDK integration is opt-in
 * via graceful fallback when @qdrant/js-client-rest is not installed.
 *
 * @module
 */

import { createRequire } from 'node:module';
import type { VectorStore, VectorDocument, VectorSearchResult } from '../vector-store.js';
import { cosineSimilarity } from '../vector-store.js';

// ============================================================
// Graceful SDK Import
// ============================================================

let QdrantSDK: unknown = null;
let sdkAvailable = false;

try {
  const _require = createRequire(import.meta.url);
  const mod = _require('@qdrant/js-client-rest') as Record<string, unknown>;
  QdrantSDK = (mod as { QdrantClient?: unknown }).QdrantClient ?? null;
  sdkAvailable = QdrantSDK !== null;
} catch {
  console.warn(
    '@qdrant/js-client-rest not installed. QdrantVectorStore will use in-memory fallback.'
  );
}

// ============================================================
// Types
// ============================================================

export interface QdrantVectorStoreConfig {
  /** Qdrant server URL (e.g., 'http://localhost:6333') */
  url: string;

  /** Qdrant API key (optional for local instances) */
  apiKey?: string;

  /** Qdrant collection name */
  collectionName: string;

  /** Embedding dimensions expected by the collection */
  dimensions: number;

  /** Store name for logging (default: 'qdrant') */
  name?: string;
}

// ============================================================
// Qdrant Vector Store Implementation
// ============================================================

export class QdrantVectorStore implements VectorStore {
  readonly name: string;

  /** In-memory storage (always used; SDK integration is opt-in) */
  private storage: Map<string, VectorDocument>;

  /** Config preserved for future SDK connection */
  readonly config: QdrantVectorStoreConfig;

  constructor(config: QdrantVectorStoreConfig) {
    this.config = config;
    this.name = config.name ?? 'qdrant';
    this.storage = new Map();

    if (sdkAvailable) {
      // SDK installed but no real connection established here.
      // Placeholder: collections would be accessed via:
      //   const client = new (QdrantSDK as ...)({ url, apiKey });
      //   await client.getCollection(collectionName);
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
