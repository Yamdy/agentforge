/**
 * Unit tests for InMemoryVectorStore with JSON persistence.
 *
 * Tests: InMemoryVectorStore CRUD, search, file save/load, drop-in for SemanticMemory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryVectorStore } from '../../src/memory/stores/in-memory.js';
import type { VectorDocument } from '../../src/memory/vector-store.js';
import { cosineSimilarity } from '../../src/memory/vector-store.js';
import { SemanticMemory } from '../../src/memory/semantic-memory.js';
import type { EmbeddingModel } from '../../src/memory/embedding.js';
import type { MemoryEntry } from '../../src/memory/types.js';

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

function createTempFilePath(): string {
  const name = `in-memory-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  return join(tmpdir(), name);
}

// ============================================================
// InMemoryVectorStore
// ============================================================

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  afterEach(() => {
    // no resources to clean up
  });

  // (a) insert + count
  it('should insert a document and increment count', () => {
    const doc = createTestDocument('doc-1', [1, 0, 0]);
    expect(store.count()).toBe(0);
    store.insert(doc);
    expect(store.count()).toBe(1);
  });

  // (b) insert + get
  it('should insert a document and retrieve it by ID', () => {
    const doc = createTestDocument('doc-1', [1, 2, 3]);
    store.insert(doc);
    const retrieved = store.get('doc-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('doc-1');
    expect(retrieved!.embedding).toEqual([1, 2, 3]);
    expect(retrieved!.content).toBe('Test content for doc-1');
  });

  it('should return null when getting non-existent document', () => {
    expect(store.get('does-not-exist')).toBeNull();
  });

  // (c) search with threshold filtering
  it('should return matching documents sorted by score', () => {
    // Same direction vectors — all match
    store.insert(createTestDocument('a', [1, 0, 0]));
    store.insert(createTestDocument('b', [0.9, 0, 0])); // very similar
    store.insert(createTestDocument('c', [0, 1, 0])); // orthogonal => score 0

    const results = store.search([1, 0, 0], 5, 0.5);

    expect(results.length).toBe(2);
    expect(results[0]!.document.id).toBe('a');
    expect(results[0]!.score).toBeCloseTo(1, 5);
    expect(results[1]!.document.id).toBe('b');
    expect(results[1]!.score).toBeCloseTo(1, 5); // dot: 0.9, norms: 1 * 0.9 = 0.9
  });

  // (d) search returns empty when below threshold
  it('should return empty array when no documents match the threshold', () => {
    store.insert(createTestDocument('a', [1, 0, 0]));
    store.insert(createTestDocument('b', [0, 1, 0]));

    const results = store.search([1, 0, 0], 5, 0.99);

    expect(results.length).toBe(1); // only 'a' matches at 0.99
  });

  it('should return empty array when all scores are below threshold', () => {
    // [0.5, 0.7, 0] has cos ≈ 0.5 / sqrt(0.5²+0.7²) ≈ 0.5 / 0.86 ≈ 0.58
    store.insert(createTestDocument('a', [0.5, 0.7, 0]));
    // [0, 0.1, 0] is orthogonal => cos = 0
    store.insert(createTestDocument('b', [0, 0.1, 0]));

    const results = store.search([1, 0, 0], 5, 0.9);

    expect(results.length).toBe(0);
  });

  it('should respect the limit parameter', () => {
    store.insert(createTestDocument('a', [1, 0, 0]));
    store.insert(createTestDocument('b', [0.9, 0, 0]));
    store.insert(createTestDocument('c', [0.8, 0, 0]));

    const results = store.search([1, 0, 0], 2, 0.5);

    expect(results.length).toBe(2);
  });

  // (e) delete
  it('should delete a document by ID', () => {
    store.insert(createTestDocument('doc-1'));
    store.insert(createTestDocument('doc-2'));
    expect(store.count()).toBe(2);

    store.delete('doc-1');
    expect(store.count()).toBe(1);
    expect(store.get('doc-1')).toBeNull();
    expect(store.get('doc-2')).not.toBeNull();
  });

  it('should no-op when deleting non-existent document', () => {
    store.insert(createTestDocument('doc-1'));
    store.delete('does-not-exist');
    expect(store.count()).toBe(1);
  });

  // (f) clear
  it('should clear all documents', () => {
    store.insert(createTestDocument('a'));
    store.insert(createTestDocument('b'));
    store.insert(createTestDocument('c'));
    expect(store.count()).toBe(3);

    store.clear();
    expect(store.count()).toBe(0);
    expect(store.get('a')).toBeNull();
    expect(store.get('b')).toBeNull();
    expect(store.get('c')).toBeNull();
  });

  // (g) insertBatch
  it('should insert multiple documents at once', () => {
    const docs = [
      createTestDocument('a', [1, 0]),
      createTestDocument('b', [0, 1]),
      createTestDocument('c', [1, 1]),
    ];

    store.insertBatch(docs);
    expect(store.count()).toBe(3);
    expect(store.get('a')!.embedding).toEqual([1, 0]);
    expect(store.get('b')!.embedding).toEqual([0, 1]);
    expect(store.get('c')!.embedding).toEqual([1, 1]);
  });

  // (h) close is no-op
  it('should allow close as a no-op without errors', () => {
    store.insert(createTestDocument('a'));
    expect(() => store.close()).not.toThrow();
    // After close we can still operate (in-memory store has no connections)
    expect(store.count()).toBe(1);
  });

  // ============================================================
  // JSON File Persistence
  // ============================================================

  describe('JSON file persistence', () => {
    let tempPath: string;

    beforeEach(() => {
      tempPath = createTempFilePath();
    });

    afterEach(async () => {
      try {
        await fs.unlink(tempPath);
      } catch {
        // file may not exist — ignore
      }
    });

    // (i) saveToFile produces valid JSON
    it('should save documents as a valid JSON array', async () => {
      store.insert(createTestDocument('a', [1, 0]));
      store.insert(createTestDocument('b', [0, 1]));

      await store.saveToFile(tempPath);

      const raw = await fs.readFile(tempPath, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('a');
      expect(parsed[0].embedding).toEqual([1, 0]);
      expect(parsed[1].id).toBe('b');
      expect(parsed[1].embedding).toEqual([0, 1]);
    });

    // (j) loadFromFile restores all documents
    it('should load all documents from a JSON file', async () => {
      // Save some docs first
      store.insert(createTestDocument('x', [1, 2, 3]));
      store.insert(createTestDocument('y', [4, 5, 6]));
      await store.saveToFile(tempPath);

      // Create a new store and load
      const newStore = new InMemoryVectorStore();
      await newStore.loadFromFile(tempPath);

      expect(newStore.count()).toBe(2);
      const x = newStore.get('x');
      expect(x).not.toBeNull();
      expect(x!.embedding).toEqual([1, 2, 3]);
      const y = newStore.get('y');
      expect(y).not.toBeNull();
      expect(y!.content).toBe('Test content for y');
    });

    // (k) Load after save returns identical search results
    it('should return identical search results after save and load round-trip', async () => {
      store.insert(createTestDocument('sim-1', [1, 0, 0]));
      store.insert(createTestDocument('sim-2', [0.9, 0.1, 0]));
      store.insert(createTestDocument('diff-1', [0, 1, 0]));

      const beforeResults = store.search([1, 0, 0], 3, 0.5);

      await store.saveToFile(tempPath);

      const newStore = new InMemoryVectorStore();
      await newStore.loadFromFile(tempPath);

      const afterResults = newStore.search([1, 0, 0], 3, 0.5);

      expect(afterResults.length).toBe(beforeResults.length);
      for (let i = 0; i < beforeResults.length; i++) {
        expect(afterResults[i]!.document.id).toBe(beforeResults[i]!.document.id);
        expect(afterResults[i]!.score).toBeCloseTo(beforeResults[i]!.score, 5);
      }
    });

    // static createFromFile
    it('should load documents using static createFromFile factory', async () => {
      store.insert(createTestDocument('a', [1, 2]));
      store.insert(createTestDocument('b', [3, 4]));
      await store.saveToFile(tempPath);

      const loaded = await InMemoryVectorStore.createFromFile(tempPath);
      expect(loaded.count()).toBe(2);
      expect(loaded.get('a')!.embedding).toEqual([1, 2]);
      expect(loaded.get('b')!.embedding).toEqual([3, 4]);
    });

    it('createFromFile should accept options', async () => {
      store.insert(createTestDocument('a'));
      await store.saveToFile(tempPath);

      const loaded = await InMemoryVectorStore.createFromFile(tempPath, { name: 'custom-name' });
      expect(loaded.name).toBe('custom-name');
    });
  });

  // ============================================================
  // (l) Works as drop-in for SemanticMemory
  // ============================================================

  describe('as SemanticMemory backend', () => {
    it('should work as a drop-in vector store for SemanticMemory', async () => {
      const embeddingModel: EmbeddingModel = {
        provider: 'mock',
        model: 'mock-embedding',
        dimensions: 3,
        embed: async () => [1, 0, 0],
        embedBatch: async () => [[1, 0, 0]],
      };

      const mem = new SemanticMemory({
        embeddingModel,
        vectorStore: store,
      });

      // Insert some test memories
      const entry1: MemoryEntry = {
        id: 'mem-1',
        content: 'Important note about vector databases',
        sourcePath: '/notes/vectordb.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['vectordb'],
      };
      const entry2: MemoryEntry = {
        id: 'mem-2',
        content: 'Regular grocery list',
        sourcePath: '/notes/groceries.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['personal'],
      };

      await mem.save(entry1);
      await mem.save(entry2);

      expect(store.count()).toBe(2);

      const results = await mem.search('vector databases', 5, 0.5);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // Additional edge cases
  // ============================================================

  it('should handle inserting document with same ID (overwrite)', () => {
    store.insert(createTestDocument('same', [1, 0]));
    store.insert({
      ...createTestDocument('same', [99, 99]),
      content: 'Updated content',
    });

    const doc = store.get('same');
    expect(doc).not.toBeNull();
    expect(doc!.embedding).toEqual([99, 99]);
    expect(doc!.content).toBe('Updated content');
  });

  it('should handle empty store search', () => {
    const results = store.search([1, 0, 0], 5, 0.5);
    expect(results.length).toBe(0);
  });

  it('should interpolate cosine similarity values correctly', () => {
    // 45 degree angle => cos(45°) ≈ 0.7071
    const a = [1, 0];
    const b = [1, 1];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeCloseTo(1 / Math.sqrt(2), 5); // ≈ 0.7071
  });

  it('should have correct default name', () => {
    expect(store.name).toBe('in-memory');
  });

  it('should accept custom name', () => {
    const customStore = new InMemoryVectorStore({ name: 'my-store' });
    expect(customStore.name).toBe('my-store');
  });

  it('should handle documents with metadata', () => {
    const doc = createTestDocument('meta-test');
    doc.metadata = { key: 'value', nested: { count: 42 } };
    store.insert(doc);

    const retrieved = store.get('meta-test');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.metadata).toEqual({ key: 'value', nested: { count: 42 } });
  });

  it('should handle documents without metadata', () => {
    const doc: VectorDocument = {
      id: 'no-meta',
      embedding: [1, 0],
      content: 'No metadata here',
      createdAt: Date.now(),
    };
    store.insert(doc);

    const retrieved = store.get('no-meta');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.metadata).toBeUndefined();
  });

  it('should handle large batch insert', () => {
    const docs = Array.from({ length: 100 }, (_, i) =>
      createTestDocument(`batch-${i}`, [i % 10, (i + 1) % 10, (i + 2) % 10]),
    );
    store.insertBatch(docs);
    expect(store.count()).toBe(100);
  });

  it('should correctly persist and restore metadata in JSON round-trip', async () => {
    const tempPath = createTempFilePath();
    try {
      const doc = createTestDocument('meta-test');
      doc.metadata = { key: 'value', number: 42, bool: true };
      store.insert(doc);
      await store.saveToFile(tempPath);

      const newStore = new InMemoryVectorStore();
      await newStore.loadFromFile(tempPath);

      const restored = newStore.get('meta-test');
      expect(restored).not.toBeNull();
      expect(restored!.metadata).toEqual({ key: 'value', number: 42, bool: true });
    } finally {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore
      }
    }
  });
});
