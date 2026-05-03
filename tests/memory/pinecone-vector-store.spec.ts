/**
 * Unit tests for PineconeVectorStore (placeholder adapter).
 *
 * Tests: PineconeVectorStore CRUD and search without real Pinecone connection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PineconeVectorStore } from '../../src/memory/stores/pinecone.js';
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
// PineconeVectorStore
// ============================================================

describe('PineconeVectorStore (placeholder)', () => {
  let store: PineconeVectorStore;

  beforeEach(() => {
    store = new PineconeVectorStore({
      apiKey: 'placeholder-key',
      environment: 'us-west1-gcp',
      indexName: 'test-index',
      dimensions: 3,
    });
  });

  // ============================================================
  // Basic CRUD + Search
  // ============================================================

  it('should insert a document and increment count', () => {
    expect(store.count()).toBe(0);
    store.insert(createTestDocument('doc-1', [1, 0, 0]));
    expect(store.count()).toBe(1);
  });

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

  // ============================================================
  // Search
  // ============================================================

  it('should return matching documents sorted by score above threshold', () => {
    store.insert(createTestDocument('a', [1, 0, 0]));
    store.insert(createTestDocument('b', [0.9, 0, 0]));
    store.insert(createTestDocument('c', [0, 1, 0]));

    const results = store.search([1, 0, 0], 5, 0.5);

    expect(results.length).toBe(2);
    expect(results[0]!.document.id).toBe('a');
    expect(results[0]!.score).toBeCloseTo(1, 5);
    expect(results[1]!.document.id).toBe('b');
  });

  it('should return empty array when no documents match the threshold', () => {
    store.insert(createTestDocument('a', [0.5, 0.7, 0]));
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

  // ============================================================
  // Mutations
  // ============================================================

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

  it('should clear all documents', () => {
    store.insert(createTestDocument('a'));
    store.insert(createTestDocument('b'));
    store.insert(createTestDocument('c'));
    expect(store.count()).toBe(3);

    store.clear();
    expect(store.count()).toBe(0);
    expect(store.get('a')).toBeNull();
  });

  it('should insert multiple documents via insertBatch', () => {
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

  // ============================================================
  // Lifecycle
  // ============================================================

  it('should close without errors and clear storage', () => {
    store.insert(createTestDocument('a'));
    expect(() => store.close()).not.toThrow();
    expect(store.count()).toBe(0);
  });

  // ============================================================
  // Configuration
  // ============================================================

  it('should have correct default name', () => {
    expect(store.name).toBe('pinecone');
  });

  it('should accept custom name via config', () => {
    const customStore = new PineconeVectorStore({
      apiKey: 'key',
      environment: 'env',
      indexName: 'idx',
      dimensions: 3,
      name: 'custom-pinecone',
    });
    expect(customStore.name).toBe('custom-pinecone');
  });

  // ============================================================
  // Edge cases
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
});
