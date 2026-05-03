/**
 * Qdrant Vector Store
 *
 * Adapts Qdrant's official SDK to AgentForge's VectorStore interface.
 * Uses in-memory Map for synchronous read access; SDK is used for persistence
 * of write operations. Falls back to in-memory-only when SDK is not installed.
 *
 * @module
 */

import { createRequire } from 'node:module';
import type { VectorStore, VectorDocument, VectorSearchResult } from '../vector-store.js';
import { cosineSimilarity } from '../vector-store.js';

// ============================================================
// Graceful SDK Import
// ============================================================

interface QdrantClient {
  upsert: (
    collectionName: string,
    opts: { points: Array<{ id: string; vector: number[]; payload?: Record<string, unknown> }> }
  ) => Promise<unknown>;
  delete: (collectionName: string, opts: { points: string[] }) => Promise<unknown>;
  deleteCollection: (collectionName: string) => Promise<unknown>;
}

type QdrantSDKConstructor = new (config: { url: string; apiKey?: string }) => QdrantClient;

let QdrantSDK: QdrantSDKConstructor | null = null;
let sdkAvailable = false;

try {
  const _require = createRequire(import.meta.url);
  const mod = _require('@qdrant/js-client-rest') as Record<string, unknown>;
  const QC = (mod as { QdrantClient?: QdrantSDKConstructor }).QdrantClient;
  if (QC) {
    QdrantSDK = QC;
    sdkAvailable = true;
  }
} catch {
  // @qdrant/js-client-rest not installed — in-memory fallback only
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

  /** In-memory storage for synchronous read access */
  private storage: Map<string, VectorDocument>;

  /** Qdrant client instance (null when SDK unavailable) */
  private client: QdrantClient | null = null;

  /** Config preserved for reconnection */
  readonly config: QdrantVectorStoreConfig;

  constructor(config: QdrantVectorStoreConfig) {
    this.config = config;
    this.name = config.name ?? 'qdrant';
    this.storage = new Map();

    if (sdkAvailable && QdrantSDK) {
      try {
        const clientConfig: Record<string, unknown> = { url: config.url };
        if (config.apiKey !== undefined) {
          clientConfig.apiKey = config.apiKey;
        }
        this.client = new QdrantSDK(clientConfig as { url: string; apiKey?: string });
      } catch {
        // SDK instantiation failed — continue with in-memory only
      }
    }
  }

  // ============================================================
  // VectorStore Interface
  // ============================================================

  insert(doc: VectorDocument): void {
    this.storage.set(doc.id, doc);
    if (this.client) {
      const payload: Record<string, unknown> | undefined = doc.metadata;
      const point =
        payload !== undefined
          ? { id: doc.id, vector: doc.embedding, payload }
          : { id: doc.id, vector: doc.embedding };
      this.client.upsert(this.config.collectionName, { points: [point] }).catch(() => {
        // Fire-and-forget: in-memory is the source of truth for sync reads
      });
    }
  }

  insertBatch(docs: VectorDocument[]): void {
    for (const doc of docs) {
      this.storage.set(doc.id, doc);
    }
    if (this.client && docs.length > 0) {
      const points = docs.map(doc => {
        const payload: Record<string, unknown> | undefined = doc.metadata;
        const base = { id: doc.id, vector: doc.embedding };
        return payload !== undefined ? { ...base, payload } : base;
      });
      this.client.upsert(this.config.collectionName, { points }).catch(() => {
        // Fire-and-forget
      });
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
    if (this.client) {
      this.client.delete(this.config.collectionName, { points: [id] }).catch(() => {});
    }
  }

  clear(): void {
    this.storage.clear();
    if (this.client) {
      this.client.deleteCollection(this.config.collectionName).catch(() => {});
    }
  }

  count(): number {
    return this.storage.size;
  }

  close(): void {
    this.storage.clear();
    this.client = null;
  }
}
