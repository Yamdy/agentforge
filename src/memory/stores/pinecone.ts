/**
 * Pinecone Vector Store
 *
 * Adapts Pinecone's official SDK to AgentForge's VectorStore interface.
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

interface PineconeClient {
  Index: (name: string) => PineconeIndex;
}

interface PineconeIndex {
  upsert: (
    vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>
  ) => Promise<unknown>;
  deleteMany: (ids: string[]) => Promise<unknown>;
  deleteAll: () => Promise<unknown>;
}

type PineconeSDKConstructor = new (config: {
  apiKey: string;
  environment: string;
}) => PineconeClient;

let PineconeSDK: PineconeSDKConstructor | null = null;
let sdkAvailable = false;

try {
  const _require = createRequire(import.meta.url);
  const mod = _require('@pinecone-database/pinecone') as Record<string, unknown>;
  const PC = (mod as { Pinecone?: PineconeSDKConstructor }).Pinecone;
  if (PC) {
    PineconeSDK = PC;
    sdkAvailable = true;
  }
} catch {
  // @pinecone-database/pinecone not installed — in-memory fallback only
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

  /** In-memory storage for synchronous read access */
  private storage: Map<string, VectorDocument>;

  /** Pinecone index instance (null when SDK unavailable) */
  private index: PineconeIndex | null = null;

  /** Config preserved for reconnection */
  readonly config: PineconeVectorStoreConfig;

  constructor(config: PineconeVectorStoreConfig) {
    this.config = config;
    this.name = config.name ?? 'pinecone';
    this.storage = new Map();

    if (sdkAvailable && PineconeSDK) {
      try {
        const client: PineconeClient = new PineconeSDK({
          apiKey: config.apiKey,
          environment: config.environment,
        });
        this.index = client.Index(config.indexName);
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
    if (this.index) {
      const metadata: Record<string, unknown> | undefined = doc.metadata;
      const vectors =
        metadata !== undefined
          ? [{ id: doc.id, values: doc.embedding, metadata }]
          : [{ id: doc.id, values: doc.embedding }];
      this.index.upsert(vectors).catch(() => {
        // Fire-and-forget: in-memory is the source of truth for sync reads
      });
    }
  }

  insertBatch(docs: VectorDocument[]): void {
    for (const doc of docs) {
      this.storage.set(doc.id, doc);
    }
    if (this.index && docs.length > 0) {
      const vectors = docs.map(doc => {
        const base = { id: doc.id, values: doc.embedding };
        const metadata: Record<string, unknown> | undefined = doc.metadata;
        return metadata !== undefined ? { ...base, metadata } : base;
      });
      this.index.upsert(vectors).catch(() => {
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
    if (this.index) {
      this.index.deleteMany([id]).catch(() => {});
    }
  }

  clear(): void {
    this.storage.clear();
    if (this.index) {
      this.index.deleteAll().catch(() => {});
    }
  }

  count(): number {
    return this.storage.size;
  }

  close(): void {
    this.storage.clear();
    this.index = null;
  }
}
