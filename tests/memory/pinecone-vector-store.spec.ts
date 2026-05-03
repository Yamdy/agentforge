/**
 * PineconeVectorStore Tests
 *
 * Placeholder adapter — uses in-memory Map (no real Pinecone connection).
 * All CRUD/search behavior is covered by the VectorStore contract suite.
 */

import { describe, beforeEach } from 'vitest';
import { PineconeVectorStore } from '../../src/memory/stores/pinecone.js';
import { runVectorStoreContractTests } from './vector-store-contract.suite.js';

describe('PineconeVectorStore', () => {
  let store: PineconeVectorStore;

  beforeEach(() => {
    store = new PineconeVectorStore({
      apiKey: 'placeholder-key',
      environment: 'us-west1-gcp',
      indexName: 'test-index',
      dimensions: 3,
    });
  });

  runVectorStoreContractTests(() => store, { storeName: 'pinecone' });

  // Pinecone-specific: custom name via constructor config
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
});
