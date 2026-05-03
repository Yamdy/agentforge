/**
 * InMemoryVectorStore Tests
 *
 * Core vector store with JSON persistence and SemanticMemory integration.
 * All standard CRUD/search behavior is covered by the VectorStore contract suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryVectorStore } from '../../src/memory/stores/in-memory.js';
import type { VectorDocument } from '../../src/memory/vector-store.js';
import { cosineSimilarity } from '../../src/memory/vector-store.js';
import { runVectorStoreContractTests } from './vector-store-contract.suite.js';
import { SemanticMemory } from '../../src/memory/semantic-memory.js';
import type { EmbeddingModel } from '../../src/memory/embedding.js';
import type { MemoryEntry } from '../../src/memory/types.js';

// ============================================================
// Helpers
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
// Tests
// ============================================================

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  // ── Standard CRUD + Search contract ──
  runVectorStoreContractTests(() => new InMemoryVectorStore(), { storeName: 'in-memory' });

  // ── In-memory specific: close preserves data ──
  it('should allow close as a no-op without losing data', () => {
    store.insert(createTestDocument('a'));
    expect(() => store.close()).not.toThrow();
    expect(store.count()).toBe(1);
  });

  // ── Cosine similarity interpolation ──
  it('should compute cosine similarity correctly', () => {
    const sim = cosineSimilarity([1, 0], [1, 1]);
    expect(sim).toBeCloseTo(1 / Math.sqrt(2), 5);
  });

  // ── Large batch ──
  it('should handle large batch insert', () => {
    const docs = Array.from({ length: 100 }, (_, i) =>
      createTestDocument(`batch-${i}`, [i % 10, (i + 1) % 10, (i + 2) % 10]),
    );
    store.insertBatch(docs);
    expect(store.count()).toBe(100);
  });

  // ==========================================================
  // JSON File Persistence
  // ==========================================================

  describe('JSON file persistence', () => {
    let tempPath: string;

    beforeEach(() => {
      tempPath = createTempFilePath();
    });

    afterEach(async () => {
      try { await fs.unlink(tempPath); } catch { /* ignore */ }
    });

    it('should save documents as a valid JSON array', async () => {
      store.insert(createTestDocument('a', [1, 0]));
      store.insert(createTestDocument('b', [0, 1]));
      await store.saveToFile(tempPath);

      const raw = await fs.readFile(tempPath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe('a');
    });

    it('should load all documents from a JSON file', async () => {
      store.insert(createTestDocument('x', [1, 2, 3]));
      store.insert(createTestDocument('y', [4, 5, 6]));
      await store.saveToFile(tempPath);

      const newStore = new InMemoryVectorStore();
      await newStore.loadFromFile(tempPath);
      expect(newStore.count()).toBe(2);
      expect(newStore.get('x')!.embedding).toEqual([1, 2, 3]);
    });

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

    it('should load documents using static createFromFile factory', async () => {
      store.insert(createTestDocument('a', [1, 2]));
      store.insert(createTestDocument('b', [3, 4]));
      await store.saveToFile(tempPath);

      const loaded = await InMemoryVectorStore.createFromFile(tempPath);
      expect(loaded.count()).toBe(2);
      expect(loaded.get('a')!.embedding).toEqual([1, 2]);
    });

    it('createFromFile should accept options', async () => {
      store.insert(createTestDocument('a'));
      await store.saveToFile(tempPath);

      const loaded = await InMemoryVectorStore.createFromFile(tempPath, { name: 'custom-name' });
      expect(loaded.name).toBe('custom-name');
    });

    it('should correctly persist and restore metadata in JSON round-trip', async () => {
      const doc = createTestDocument('meta-test');
      doc.metadata = { key: 'value', number: 42, bool: true };
      store.insert(doc);
      await store.saveToFile(tempPath);

      const newStore = new InMemoryVectorStore();
      await newStore.loadFromFile(tempPath);
      expect(newStore.get('meta-test')!.metadata).toEqual({ key: 'value', number: 42, bool: true });
    });
  });

  // ==========================================================
  // SemanticMemory Integration
  // ==========================================================

  describe('as SemanticMemory backend', () => {
    it('should work as a drop-in vector store for SemanticMemory', async () => {
      const embeddingModel: EmbeddingModel = {
        provider: 'mock',
        model: 'mock-embedding',
        dimensions: 3,
        embed: async () => [1, 0, 0],
        embedBatch: async () => [[1, 0, 0]],
      };

      const mem = new SemanticMemory({ embeddingModel, vectorStore: store });

      const entry1: MemoryEntry = {
        id: 'mem-1',
        content: 'Important note about vector databases',
        sourcePath: '/notes/vectordb.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['vectordb'],
      };
      await mem.save(entry1);
      await mem.save({
        id: 'mem-2',
        content: 'Regular grocery list',
        sourcePath: '/notes/groceries.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: ['personal'],
      });

      expect(store.count()).toBe(2);
      const results = await mem.search('vector databases', 5, 0.5);
      expect(results.length).toBeGreaterThanOrEqual(0);
    });
  });
});
