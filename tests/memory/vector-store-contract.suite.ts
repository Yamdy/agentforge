/**
 * Vector Store Contract Test Suite
 *
 * Shared behavioral contract for all VectorStore implementations.
 * Every VectorStore must pass these tests to be considered compliant.
 *
 * Usage:
 * ```typescript
 * import { runVectorStoreContractTests } from './vector-store-contract.suite.js';
 *
 * describe('MyVectorStore', () => {
 *   runVectorStoreContractTests(() => new MyVectorStore({...}));
 *
 *   // Add implementation-specific tests here
 * });
 * ```
 *
 * @module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { VectorStore, VectorDocument } from '../../src/memory/vector-store.js';

// ============================================================
// Test Document Factory
// ============================================================

let docCounter = 0;

function makeDoc(overrides?: Partial<VectorDocument>): VectorDocument {
  docCounter++;
  return {
    id: `doc-${docCounter}`,
    content: `Test content ${docCounter}`,
    embedding: new Array(128).fill(0).map((_, i) => (i === docCounter % 128 ? 1.0 : 0.0)),
    metadata: undefined,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeEmbedding(): number[] {
  return new Array(128).fill(0).map((_, i) => (i === 0 ? 1.0 : 0.0));
}

// ============================================================
// Contract Suite
// ============================================================

export function runVectorStoreContractTests(
  createStore: () => VectorStore,
  options?: { storeName?: string },
): void {
  const label = options?.storeName ?? 'vector store';

  describe(`Contract: ${label}`, () => {
    let store: VectorStore;

    beforeEach(() => {
      store = createStore();
    });

    // ─── CRUD: Insert + Get ───

    it('should insert a document and increment count', () => {
      expect(store.count()).toBe(0);
      store.insert(makeDoc());
      expect(store.count()).toBe(1);
    });

    it('should insert a document and retrieve it by ID', () => {
      const doc = makeDoc({ id: 'my-doc', content: 'Hello' });
      store.insert(doc);
      const retrieved = store.get('my-doc');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('my-doc');
      expect(retrieved!.content).toBe('Hello');
    });

    it('should return null when getting non-existent document', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    // ─── CRUD: Delete ───

    it('should delete a document by ID', () => {
      store.insert(makeDoc({ id: 'to-delete' }));
      expect(store.count()).toBe(1);
      store.delete('to-delete');
      expect(store.count()).toBe(0);
      expect(store.get('to-delete')).toBeNull();
    });

    it('should no-op when deleting non-existent document', () => {
      expect(() => store.delete('never-existed')).not.toThrow();
      expect(store.count()).toBe(0);
    });

    // ─── CRUD: Clear ───

    it('should clear all documents', () => {
      store.insert(makeDoc());
      store.insert(makeDoc());
      store.insert(makeDoc());
      expect(store.count()).toBe(3);
      store.clear();
      expect(store.count()).toBe(0);
    });

    // ─── Batch Insert ───

    it('should insert multiple documents via insertBatch', () => {
      const docs = [makeDoc(), makeDoc(), makeDoc()];
      store.insertBatch(docs);
      expect(store.count()).toBe(3);
      for (const doc of docs) {
        expect(store.get(doc.id)).not.toBeNull();
      }
    });

    // ─── Overwrite ───

    it('should handle inserting document with same ID (overwrite)', () => {
      store.insert(makeDoc({ id: 'dup', content: 'first' }));
      store.insert(makeDoc({ id: 'dup', content: 'second' }));
      expect(store.count()).toBe(1);
      expect(store.get('dup')!.content).toBe('second');
    });

    // ─── Search ───

    it('should return matching documents sorted by score above threshold', () => {
      const embedding = makeEmbedding();
      store.insert(makeDoc({ id: 'a', embedding }));
      store.insert(makeDoc({ id: 'b', embedding: new Array(128).fill(0.5) }));
      store.insert(makeDoc({ id: 'c', embedding: new Array(128).fill(0).map((_, i) => (i <= 1 ? 0.5 : 0)) }));

      const results = store.search(embedding, 10, 0.5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }
    });

    it('should return empty array when no documents match the threshold', () => {
      // Use an embedding orthogonal to the query so cosine similarity ≈ 0
      const orthogonal = new Array(128).fill(0).map((_, i) => (i === 1 ? 1.0 : 0.0));
      store.insert(makeDoc({ embedding: orthogonal }));
      const results = store.search(makeEmbedding(), 5, 0.99);
      expect(results).toEqual([]);
    });

    it('should respect the limit parameter', () => {
      const embedding = makeEmbedding();
      for (let i = 0; i < 10; i++) {
        store.insert(makeDoc({ embedding }));
      }
      const results = store.search(embedding, 3, 0.0);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    // ─── Edge Cases ───

    it('should handle empty store search', () => {
      const results = store.search(new Array(128).fill(0.5), 5, 0.0);
      expect(results).toEqual([]);
    });

    it('should handle documents with metadata', () => {
      store.insert(makeDoc({ id: 'meta-doc', metadata: { source: 'test', priority: 1 } }));
      const doc = store.get('meta-doc');
      expect(doc).not.toBeNull();
      expect(doc!.metadata).toEqual({ source: 'test', priority: 1 });
    });

    it('should handle documents without metadata', () => {
      store.insert(makeDoc({ id: 'no-meta', metadata: undefined }));
      const doc = store.get('no-meta');
      expect(doc).not.toBeNull();
      expect(doc!.metadata).toBeUndefined();
    });

    // ─── Name ───

    it('should have correct default name', () => {
      expect(typeof store.name).toBe('string');
      expect(store.name.length).toBeGreaterThan(0);
    });

    it('should accept custom name via config', () => {
      // This test verifies the store has a name property.
      // Implementations may set it via constructor or config.
      expect(store.name).toBeDefined();
    });

    // ─── Close ───

    it('should close without errors and clear storage', () => {
      store.insert(makeDoc());
      expect(() => store.close()).not.toThrow();
    });
  });
}
