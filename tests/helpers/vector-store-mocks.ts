/**
 * Shared Mock Implementations for Vector Store and Embedding
 *
 * Canonical mocks extracted from tests/memory/strategies.spec.ts
 * and tests/memory/compaction.spec.ts.
 *
 * @module
 */

import type { VectorStore, VectorDocument } from '../../src/memory/vector-store.js';
import type { EmbeddingModel } from '../../src/memory/embedding.js';
import type { Message } from '../../src/core/interfaces.js';

// ============================================================
// InMemoryVectorStore
// ============================================================

export class InMemoryVectorStore implements VectorStore {
  readonly name: string;
  private docs = new Map<string, VectorDocument>();

  constructor(name = 'test-store') {
    this.name = name;
  }

  insert(doc: VectorDocument): void {
    this.docs.set(doc.id, doc);
  }

  insertBatch(docs: VectorDocument[]): void {
    for (const doc of docs) this.insert(doc);
  }

  search(_embedding: number[], limit = 5, _threshold = 0.7) {
    return Array.from(this.docs.values())
      .slice(0, limit)
      .map(doc => ({ document: doc, score: 0.95 }));
  }

  get(id: string): VectorDocument | null {
    return this.docs.get(id) ?? null;
  }

  delete(id: string): void {
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
  }

  count(): number {
    return this.docs.size;
  }

  close(): void {
    this.docs.clear();
  }
}

// ============================================================
// MockEmbeddingModel
// ============================================================

export class MockEmbeddingModel implements EmbeddingModel {
  private dimensions: number;
  private fillValue: number;

  constructor(dimensions = 128, fillValue = 0.1) {
    this.dimensions = dimensions;
    this.fillValue = fillValue;
  }

  async embed(_text: string): Promise<number[]> {
    return new Array(this.dimensions).fill(this.fillValue);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(this.dimensions).fill(this.fillValue));
  }
}

// ============================================================
// FailingEmbeddingModel
// ============================================================

export class FailingEmbeddingModel implements EmbeddingModel {
  async embed(): Promise<number[]> {
    throw new Error('embed failed');
  }

  async embedBatch(): Promise<number[][]> {
    throw new Error('batch embed failed');
  }
}

// ============================================================
// createTestMessages
// ============================================================

export function createTestMessages(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Test message ${i}`,
    });
  }
  return msgs;
}
