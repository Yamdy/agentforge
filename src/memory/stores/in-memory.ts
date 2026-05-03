/**
 * In-Memory Vector Store with JSON file persistence.
 *
 * Lightweight, zero-dependency in-memory storage. Supports save/load to/from JSON files.
 *
 * @module
 */

import { promises as fs } from 'node:fs';
import type { VectorStore, VectorDocument, VectorSearchResult } from '../vector-store.js';
import { cosineSimilarity } from '../vector-store.js';

// ============================================================
// Types
// ============================================================

export interface InMemoryVectorStoreOptions {
  /** Store name for logging (default: 'in-memory') */
  name?: string;
}

// ============================================================
// In-Memory Vector Store Implementation
// ============================================================

export class InMemoryVectorStore implements VectorStore {
  readonly name: string;

  private storage: Map<string, VectorDocument>;

  constructor(options?: InMemoryVectorStoreOptions) {
    this.name = options?.name ?? 'in-memory';
    this.storage = new Map();
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
    // No-op: in-memory store has no external resources
  }

  // ============================================================
  // JSON File Persistence
  // ============================================================

  /**
   * Save all documents to a JSON file.
   *
   * @param path - File path to write to
   */
  async saveToFile(path: string): Promise<void> {
    const docs = Array.from(this.storage.values());
    const json = JSON.stringify(docs, null, 2);
    await fs.writeFile(path, json, 'utf-8');
  }

  /**
   * Load documents from a JSON file into the store.
   *
   * Existing documents with matching IDs will be overwritten.
   *
   * @param path - File path to read from
   */
  async loadFromFile(path: string): Promise<void> {
    const json = await fs.readFile(path, 'utf-8');
    const docs = JSON.parse(json) as VectorDocument[];

    for (const doc of docs) {
      this.storage.set(doc.id, doc);
    }
  }

  /**
   * Create an InMemoryVectorStore and immediately load from a JSON file.
   *
   * @param path - File path to load documents from
   * @param options - Optional store configuration
   * @returns Initialized store with loaded documents
   */
  static async createFromFile(
    path: string,
    options?: InMemoryVectorStoreOptions
  ): Promise<InMemoryVectorStore> {
    const store = new InMemoryVectorStore(options);
    await store.loadFromFile(path);
    return store;
  }
}
