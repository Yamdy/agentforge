/**
 * Unit tests for SQLite Vector Store
 *
 * Tests: SQLiteVectorStore CRUD operations, search, cosine similarity.
 * Uses in-memory SQLite database — no file I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteVectorStore } from '../../src/memory/stores/sqlite.js';
import { cosineSimilarity } from '../../src/memory/vector-store.js';
import type { VectorDocument } from '../../src/memory/vector-store.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestDocument(id: string, embedding?: number[]): VectorDocument {
  return {
    id,
    embedding: embedding ?? [1, 0, 0, 0, 0],
    content: `Test content for ${id}`,
    metadata: { source: 'test' },
    createdAt: Date.now(),
  };
}

// ============================================================
// cosineSimilarity
// ============================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should return -1 for opposite vectors', () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBe(-1);
  });

  it('should throw for vectors of different lengths', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow('Vectors must have same length');
  });
});

// ============================================================
// SQLiteVectorStore
// ============================================================

describe('SQLiteVectorStore', () => {
  let store: SQLiteVectorStore;

  beforeEach(() => {
    store = new SQLiteVectorStore(); // in-memory
  });

  afterEach(() => {
    store.close();
  });

  describe('insert()', () => {
    it('should insert a document', () => {
      const doc = createTestDocument('test-1');
      store.insert(doc);
      expect(store.count()).toBe(1);
    });

    it('should overwrite existing document with same ID', () => {
      const doc1 = createTestDocument('test-1');
      const doc2 = { ...doc1, content: 'Updated content' };
      
      store.insert(doc1);
      store.insert(doc2);
      
      expect(store.count()).toBe(1);
      expect(store.get('test-1')?.content).toBe('Updated content');
    });
  });

  describe('insertBatch()', () => {
    it('should insert multiple documents', () => {
      const docs = [
        createTestDocument('batch-1'),
        createTestDocument('batch-2'),
        createTestDocument('batch-3'),
      ];
      
      store.insertBatch(docs);
      expect(store.count()).toBe(3);
    });
  });

  describe('get()', () => {
    it('should return document by ID', () => {
      const doc = createTestDocument('get-test');
      store.insert(doc);
      
      const result = store.get('get-test');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('get-test');
      expect(result?.content).toBe('Test content for get-test');
    });

    it('should return null for non-existent ID', () => {
      expect(store.get('non-existent')).toBeNull();
    });

    it('should preserve metadata', () => {
      const doc = createTestDocument('meta-test');
      store.insert(doc);
      
      const result = store.get('meta-test');
      expect(result?.metadata).toEqual({ source: 'test' });
    });
  });

  describe('delete()', () => {
    it('should delete document by ID', () => {
      store.insert(createTestDocument('del-test'));
      store.delete('del-test');
      expect(store.get('del-test')).toBeNull();
    });

    it('should not throw for non-existent ID', () => {
      expect(() => store.delete('non-existent')).not.toThrow();
    });
  });

  describe('clear()', () => {
    it('should remove all documents', () => {
      store.insert(createTestDocument('clear-1'));
      store.insert(createTestDocument('clear-2'));
      store.clear();
      expect(store.count()).toBe(0);
    });
  });

  describe('count()', () => {
    it('should return 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('should return correct count', () => {
      store.insert(createTestDocument('count-1'));
      store.insert(createTestDocument('count-2'));
      expect(store.count()).toBe(2);
    });
  });

  describe('search()', () => {
    it('should find similar documents', () => {
      // 向量：[1,0,0] 和 [0.9,0.1,0] 应该很相似
      store.insert(createTestDocument('sim-1', [1, 0, 0]));
      store.insert(createTestDocument('sim-2', [0, 1, 0]));
      
      const results = store.search([0.9, 0.1, 0], 2, 0.5);
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.document.id).toBe('sim-1');
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        store.insert(createTestDocument(`limit-${i}`, [1, 0, 0]));
      }
      
      const results = store.search([1, 0, 0], 3);
      expect(results.length).toBe(3);
    });

    it('should respect threshold parameter', () => {
      store.insert(createTestDocument('thresh-1', [1, 0, 0]));
      store.insert(createTestDocument('thresh-2', [0, 1, 0]));
      
      // 阈值设为 0.99，只有完全匹配才通过
      const results = store.search([1, 0, 0], 10, 0.99);
      expect(results.length).toBe(1);
    });

    it('should return results sorted by score descending', () => {
      store.insert(createTestDocument('sort-1', [0.8, 0.2, 0]));
      store.insert(createTestDocument('sort-2', [1, 0, 0]));
      
      const results = store.search([1, 0, 0], 10);
      
      expect(results.length).toBe(2);
      expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    });
  });
});
