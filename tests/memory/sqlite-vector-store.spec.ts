/**
 * Unit tests for SQLite Vector Store
 *
 * Uses in-memory SQLite database — no file I/O.
 * All CRUD/search behavior is covered by the VectorStore contract suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteVectorStore } from '../../src/memory/stores/sqlite.js';
import { cosineSimilarity } from '../../src/memory/vector-store.js';
import { runVectorStoreContractTests } from './vector-store-contract.suite.js';

// ============================================================
// cosineSimilarity — pure math
// ============================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it('should return -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
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
    store = new SQLiteVectorStore();
  });

  afterEach(() => {
    store.close();
  });

  runVectorStoreContractTests(() => new SQLiteVectorStore(), { storeName: 'sqlite' });

  // SQLite-specific: name is hardcoded
  it('should use hardcoded name "sqlite"', () => {
    expect(store.name).toBe('sqlite');
  });

  // SQLite-specific: close should clean up the database
  it('should close database and prevent further operations', () => {
    store.insert({
      id: 'pre-close',
      embedding: [1, 0, 0],
      content: 'before close',
      metadata: undefined,
      createdAt: Date.now(),
    });
    expect(store.count()).toBe(1);

    store.close();
    // After close, the database is gone — expect errors on operations
    expect(() => store.insert({
      id: 'post-close',
      embedding: [0, 1, 0],
      content: 'after close',
      metadata: undefined,
      createdAt: Date.now(),
    })).toThrow();
  });
});
