/**
 * QdrantVectorStore Tests
 *
 * Placeholder adapter — uses in-memory Map (no real Qdrant connection).
 * All CRUD/search behavior is covered by the VectorStore contract suite.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { QdrantVectorStore } from '../../src/memory/stores/qdrant.js';
import { runVectorStoreContractTests } from './vector-store-contract.suite.js';

describe('QdrantVectorStore', () => {
  let store: QdrantVectorStore;

  beforeEach(() => {
    store = new QdrantVectorStore({
      url: 'http://localhost:6333',
      apiKey: 'placeholder-key',
      collectionName: 'test-collection',
      dimensions: 3,
    });
  });

  runVectorStoreContractTests(() => store, { storeName: 'qdrant' });

  // Qdrant-specific tests

  it('should accept custom name via config', () => {
    const customStore = new QdrantVectorStore({
      url: 'http://localhost:6333',
      collectionName: 'col',
      dimensions: 3,
      name: 'custom-qdrant',
    });
    expect(customStore.name).toBe('custom-qdrant');
  });

  it('should work without apiKey (optional)', () => {
    const noKeyStore = new QdrantVectorStore({
      url: 'http://localhost:6333',
      collectionName: 'col',
      dimensions: 5,
    });
    expect(noKeyStore.name).toBe('qdrant');
  });
});
