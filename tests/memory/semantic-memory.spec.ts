/**
 * Unit tests for Semantic Memory Manager
 *
 * Tests: SemanticMemory CRUD, search, formatForPrompt.
 * Uses mock embedding model — no network access required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SemanticMemory, createSemanticMemory } from '../../src/memory/semantic-memory.js';
import { SQLiteVectorStore } from '../../src/memory/stores/sqlite.js';
import type { EmbeddingModel } from '../../src/memory/embedding.js';
import type { MemoryEntry } from '../../src/memory/types.js';

// ============================================================
// Mock Embedding Model
// ============================================================

function createMockEmbedding(): EmbeddingModel {
  return {
    provider: 'mock',
    model: 'mock-embedding',
    dimensions: 3,
    embed: vi.fn().mockResolvedValue([1, 0, 0]),
    embedBatch: vi.fn().mockResolvedValue([[1, 0, 0], [0, 1, 0]]),
  };
}

// ============================================================
// Test Helpers
// ============================================================

function createTestEntry(id: string, content?: string): MemoryEntry {
  return {
    id,
    content: content ?? `Test memory content for ${id}`,
    sourcePath: `/test/${id}.md`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags: ['test'],
  };
}

// ============================================================
// SemanticMemory
// ============================================================

describe('SemanticMemory', () => {
  let memory: SemanticMemory;
  let embedding: EmbeddingModel;
  let store: SQLiteVectorStore;

  beforeEach(() => {
    embedding = createMockEmbedding();
    store = new SQLiteVectorStore();
    memory = new SemanticMemory({
      embeddingModel: embedding,
      vectorStore: store,
    });
  });

  afterEach(() => {
    store.close();
  });

  describe('save()', () => {
    it('should save entry to vector store', async () => {
      const entry = createTestEntry('save-1');
      await memory.save(entry);
      
      expect(store.count()).toBe(1);
    });

    it('should call embeddingModel.embed() with entry content', async () => {
      const entry = createTestEntry('save-embed', 'Hello world');
      await memory.save(entry);

      expect(embedding.embed).toHaveBeenCalledWith('Hello world');
    });

    it('should store real embedding (not placeholder)', async () => {
      const entry = createTestEntry('save-embedding');
      await memory.save(entry);

      // Verify the stored document has a non-empty embedding
      const doc = store.get('save-embedding');
      expect(doc).not.toBeNull();
      expect(doc!.embedding).toEqual([1, 0, 0]); // mock embedding
    });
  });

  describe('search()', () => {
    it('should search with default parameters', async () => {
      await memory.save(createTestEntry('search-1', 'First entry'));
      await memory.save(createTestEntry('search-2', 'Second entry'));
      
      const results = await memory.search('query', 5, 0.7);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should call embeddingModel.embed() with query string', async () => {
      await memory.save(createTestEntry('search-embed', 'Hello world'));
      (embedding.embed as ReturnType<typeof vi.fn>).mockClear();

      await memory.search('test query');

      expect(embedding.embed).toHaveBeenCalledWith('test query');
    });

    it('should return MemoryEntry format', async () => {
      await memory.save(createTestEntry('format-1'));
      const entry = memory.get('format-1');
      expect(entry).not.toBeNull();
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('content');
      expect(entry).toHaveProperty('sourcePath');
      expect(entry).toHaveProperty('createdAt');
    });
  });

  describe('get()', () => {
    it('should return entry by ID', async () => {
      await memory.save(createTestEntry('get-test'));
      
      const result = memory.get('get-test');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('get-test');
    });

    it('should return null for non-existent ID', () => {
      expect(memory.get('non-existent')).toBeNull();
    });
  });

  describe('delete()', () => {
    it('should delete entry by ID', async () => {
      await memory.save(createTestEntry('del-test'));
      memory.delete('del-test');
      expect(memory.get('del-test')).toBeNull();
    });
  });

  describe('clear()', () => {
    it('should clear all entries', async () => {
      await memory.save(createTestEntry('clear-1'));
      await memory.save(createTestEntry('clear-2'));
      memory.clear();
      expect(memory.count()).toBe(0);
    });
  });

  describe('count()', () => {
    it('should return correct count', async () => {
      await memory.save(createTestEntry('count-1'));
      await memory.save(createTestEntry('count-2'));
      expect(memory.count()).toBe(2);
    });
  });

  describe('formatForPrompt()', () => {
    it('should format entries for prompt injection', () => {
      const entries = [
        createTestEntry('fmt-1', 'First memory'),
        createTestEntry('fmt-2', 'Second memory'),
      ];
      
      const result = memory.formatForPrompt(entries);
      expect(result).toContain('## Relevant Memories');
      expect(result).toContain('[1] First memory');
      expect(result).toContain('[2] Second memory');
    });

    it('should return empty string for empty array', () => {
      expect(memory.formatForPrompt([])).toBe('');
    });
  });
});

// ============================================================
// Factory Function
// ============================================================

describe('createSemanticMemory', () => {
  it('should create memory with OpenAI embedding', () => {
    // Mock process.env for API key
    const originalEnv = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    
    const store = new SQLiteVectorStore();
    const memory = createSemanticMemory({
      embeddingProvider: 'openai',
      vectorStore: store,
    });
    
    expect(memory).toBeInstanceOf(SemanticMemory);
    expect(memory.embeddingModel.provider).toBe('openai');
    
    store.close();
    process.env.OPENAI_API_KEY = originalEnv;
  });
});
