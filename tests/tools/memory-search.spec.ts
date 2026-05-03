/**
 * MemorySearchTool Tests
 *
 * Tests for the memory_search tool: semantic search of archived memories
 * using vector embeddings. Covers valid queries, parameter validation,
 * boundary values, error handling, and edge cases.
 *
 * TDD: Write tests FIRST, watch them fail, then implement.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolDefinition } from '../../src/core/interfaces.js';
import type { EmbeddingModel } from '../../src/memory/embedding.js';
import type {
  VectorStore,
  VectorDocument,
  VectorSearchResult,
} from '../../src/memory/vector-store.js';
import { cosineSimilarity } from '../../src/memory/vector-store.js';

// ============================================================
// Constants
// ============================================================

const DIMENSIONS = 128;
const FIXED_EMBEDDING = Object.freeze(
  new Array<number>(DIMENSIONS).fill(1)
) as readonly number[];

// ============================================================
// Mock Document Factory
// ============================================================

function createDoc(
  id: string,
  content: string,
  embedding: number[]
): VectorDocument {
  return {
    id,
    embedding,
    content,
    createdAt: Date.now(),
  };
}

// ============================================================
// Mock Embedding Model Factory
// ============================================================

function createMockEmbeddingModel(
  shouldThrow = false
): EmbeddingModel {
  return {
    provider: 'mock',
    model: 'mock-embedding',
    dimensions: DIMENSIONS,
    embed: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('Embedding service unavailable'))
      : vi.fn().mockResolvedValue([...FIXED_EMBEDDING]),
    embedBatch: vi.fn(),
  };
}

// ============================================================
// Mock Vector Store Factory
// ============================================================

function createMockVectorStore(
  documents: VectorDocument[] = [],
  shouldThrowSearch = false
): VectorStore {
  const storage = new Map<string, VectorDocument>();
  for (const doc of documents) {
    storage.set(doc.id, doc);
  }

  const searchImpl = shouldThrowSearch
    ? vi.fn(() => {
        throw new Error('Vector store connection failed');
      })
    : vi.fn(
        (
          embedding: number[],
          limit: number = 5,
          threshold: number = 0.7
        ): VectorSearchResult[] => {
          const results: VectorSearchResult[] = [];
          for (const doc of storage.values()) {
            const score = cosineSimilarity(embedding, doc.embedding);
            if (score >= threshold) {
              results.push({ document: doc, score });
            }
          }
          results.sort((a, b) => b.score - a.score);
          return results.slice(0, limit);
        }
      );

  return {
    name: 'mock-vector-store',
    insert: vi.fn((doc: VectorDocument) => {
      storage.set(doc.id, doc);
    }),
    insertBatch: vi.fn(),
    search: searchImpl,
    get: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    count: vi.fn(() => storage.size),
    close: vi.fn(),
  };
}

// ============================================================
// Helpers for building test documents
// ============================================================

/**
 * Create a document whose embedding is a uniform vector (all same value).
 * Cosine similarity with FIXED_EMBEDDING = 1.0 (perfect match).
 */
function createMatchingDoc(id: string, content: string): VectorDocument {
  return createDoc(id, content, [...FIXED_EMBEDDING]);
}

/**
 * Create a document whose embedding is orthogonal to FIXED_EMBEDDING.
 * First half = 1, second half = -1 → dot product = 0 → cosine = 0.
 */
function createNonMatchingDoc(id: string, content: string): VectorDocument {
  const half = Math.floor(DIMENSIONS / 2);
  const embedding = new Array<number>(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i++) {
    embedding[i] = i < half ? 1 : -1;
  }
  return createDoc(id, content, embedding);
}

// ============================================================
// Tests
// ============================================================

describe('MemorySearchTool', () => {
  // ============================================================
  // (a) Valid query returns formatted results
  // ============================================================

  it('should return formatted results for valid query', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    const docs = [
      createMatchingDoc('1', 'TypeScript is a strongly typed programming language'),
      createMatchingDoc('2', 'React is a popular frontend framework for building UIs'),
    ];
    const vectorStore = createMockVectorStore(docs);
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: 'TypeScript' });

    // Should contain the markdown table header
    expect(result).toContain('| # | Score | Content |');
    expect(result).toContain('|----|-------|---------|');
    // Should contain both results with perfect scores
    expect(result).toContain('| 1 | 1.00 |');
    expect(result).toContain('| 2 | 1.00 |');
    // Should contain the content
    expect(result).toContain('TypeScript is a strongly typed');
    expect(result).toContain('React is a popular frontend');
  });

  // ============================================================
  // (b) Empty query rejection (Zod validation)
  // ============================================================

  it('should reject empty query string', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    const vectorStore = createMockVectorStore();
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: '' });

    expect(result).toContain('Error');
    expect(result).toMatch(/query|string/i);
  });

  // ============================================================
  // (c) Missing query field
  // ============================================================

  it('should reject missing query field', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    const vectorStore = createMockVectorStore();
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({});

    expect(result).toContain('Error');
    expect(result).toMatch(/query/i);
  });

  // ============================================================
  // (d) Custom limit/threshold params
  // ============================================================

  it('should accept custom limit and threshold parameters', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    // Create 5 matching docs and 1 non-matching
    const docs = [
      createMatchingDoc('1', 'Memory alpha'),
      createMatchingDoc('2', 'Memory beta'),
      createMatchingDoc('3', 'Memory gamma'),
      createMatchingDoc('4', 'Memory delta'),
      createMatchingDoc('5', 'Memory epsilon'),
      createNonMatchingDoc('6', 'Should not match'),
    ];
    const vectorStore = createMockVectorStore(docs);
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({
      query: 'test',
      limit: 3,
      threshold: 0.5,
    });

    // Should only have 3 results (not 5)
    expect(result).toContain('| 1 |');
    expect(result).toContain('| 2 |');
    expect(result).toContain('| 3 |');
    expect(result).not.toContain('| 4 |');
    // Non-matching doc should not appear
    expect(result).not.toContain('Should not match');
  });

  // ============================================================
  // (e) No results (below threshold)
  // ============================================================

  it('should return empty message when no results above threshold', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    // All docs are orthogonal (cosine ~0), below default threshold of 0.7
    const docs = [
      createNonMatchingDoc('1', 'Irrelevant memory one'),
      createNonMatchingDoc('2', 'Irrelevant memory two'),
    ];
    const vectorStore = createMockVectorStore(docs);
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: 'relevant query' });

    expect(result).toMatch(/no matching memories/i);
    expect(result).not.toContain('| # |');
  });

  // ============================================================
  // (f) Error from embedding model (returns error string)
  // ============================================================

  it('should return error string when embedding model fails', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    const vectorStore = createMockVectorStore();
    const embeddingModel = createMockEmbeddingModel(true);

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: 'any query' });

    expect(result).toContain('Error');
    expect(result).toMatch(/embedding/i);
    expect(result).toContain('Embedding service unavailable');
  });

  // ============================================================
  // (g) Error from vector store (returns error string)
  // ============================================================

  it('should return error string when vector store fails', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    const vectorStore = createMockVectorStore([], true);
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: 'any query' });

    expect(result).toContain('Error');
    expect(result).toMatch(/vector store/i);
    expect(result).toContain('Vector store connection failed');
  });

  // ============================================================
  // (h) limit boundary value 1
  // ============================================================

  it('should accept limit boundary value 1', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    const docs = [
      createMatchingDoc('a', 'First result'),
      createMatchingDoc('b', 'Second result'),
      createMatchingDoc('c', 'Third result'),
    ];
    const vectorStore = createMockVectorStore(docs);
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: 'test', limit: 1 });

    // Should only return 1 result
    expect(result).toContain('| 1 |');
    expect(result).not.toContain('| 2 |');
  });

  // ============================================================
  // (i) limit boundary value 50
  // ============================================================

  it('should accept limit boundary value 50', async () => {
    const { createMemorySearchTool } = await import(
      '../../src/tools/memory-search.js'
    );

    // Create 55 matching docs to verify limit=50 caps results
    const docs: VectorDocument[] = [];
    for (let i = 0; i < 55; i++) {
      docs.push(
        createMatchingDoc(String(i), `Memory item number ${i}`)
      );
    }
    const vectorStore = createMockVectorStore(docs);
    const embeddingModel = createMockEmbeddingModel();

    const tools = createMemorySearchTool(vectorStore, embeddingModel);
    const tool = tools[0]!;

    const result = await tool.execute({ query: 'test', limit: 50 });

    // Should have max 50 results
    expect(result).toContain('| 1 |');
    expect(result).toContain('| 50 |');
    expect(result).not.toContain('| 51 |');
  });
});
