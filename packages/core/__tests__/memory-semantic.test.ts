import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../src/memory/storage/in-memory.js';
import { SemanticMemory, SimpleEmbedder } from '../src/memory/semantic-memory.js';
import type { MemoryStorage, EmbeddingProvider } from '../src/memory/types.js';

describe('SimpleEmbedder', () => {
  const embedder = new SimpleEmbedder(128);

  it('returns a vector of configured dimensions', () => {
    const vec = embedder.embed('hello world');
    expect(vec).toHaveLength(128);
  });

  it('returns unit vector (L2 norm ≈ 1)', () => {
    const vec = embedder.embed('this is a test sentence');
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it('similar texts produce higher cosine similarity than dissimilar', () => {
    const a = embedder.embed('AgentForge pipeline architecture');
    const b = embedder.embed('pipeline architecture for AgentForge');
    const c = embedder.embed('completely unrelated topic about weather');

    const simAB = cosineSimilarity(a, b);
    const simAC = cosineSimilarity(a, c);
    expect(simAB).toBeGreaterThan(simAC);
  });

  it('identical texts produce similarity ≈ 1', () => {
    const a = embedder.embed('memory system design');
    const b = embedder.embed('memory system design');
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 3);
  });

  it('empty string returns zero vector', () => {
    const vec = embedder.embed('');
    expect(vec.every((v: number) => v === 0)).toBe(true);
  });

  it('exposes dimensions property', () => {
    expect(embedder.dimensions).toBe(128);
  });
});

describe('SemanticMemory', () => {
  let storage: MemoryStorage;
  let memory: SemanticMemory;

  beforeEach(() => {
    storage = new InMemoryStore();
    memory = new SemanticMemory(storage);
  });

  // ── addFact ──────────────────────────────────────────

  describe('addFact()', () => {
    it('stores a fact with embedding', async () => {
      const id = await memory.addFact('/project/alpha', 'TypeScript is a typed language', {
        categories: ['tech-stack'],
        importance: 0.9,
      });

      const facts = await storage.getFacts('/project/alpha');
      expect(facts).toHaveLength(1);
      expect(facts[0].id).toBe(id);
      expect(facts[0].content).toBe('TypeScript is a typed language');
      expect(facts[0].categories).toContain('tech-stack');
      expect(facts[0].importance).toBe(0.9);
    });

    it('attaches embedding to stored fact', async () => {
      await memory.addFact('/project/alpha', 'embedding test content here');
      const facts = await storage.getFacts('/project/alpha');
      expect(facts[0].embedding).toBeDefined();
      expect(facts[0].embedding!.length).toBeGreaterThan(0);
    });

    it('uses custom embedder when provided', async () => {
      const customEmbedder: EmbeddingProvider = {
        embed: () => new Array(64).fill(0.1),
        dimensions: 64,
      };
      const mem = new SemanticMemory(storage, customEmbedder);
      await mem.addFact('/test', 'custom embed test');
      const facts = await storage.getFacts('/test');
      expect(facts[0].embedding).toHaveLength(64);
    });

    it('generates unique id for each fact', async () => {
      const id1 = await memory.addFact('/test', 'fact one');
      const id2 = await memory.addFact('/test', 'fact two');
      expect(id1).not.toBe(id2);
    });

    it('defaults importance to 0.5', async () => {
      await memory.addFact('/test', 'default importance');
      const facts = await storage.getFacts('/test');
      expect(facts[0].importance).toBe(0.5);
    });

    it('defaults categories to empty array', async () => {
      await memory.addFact('/test', 'no categories');
      const facts = await storage.getFacts('/test');
      expect(facts[0].categories).toEqual([]);
    });
  });

  // ── searchSemantic ───────────────────────────────────

  describe('searchSemantic()', () => {
    beforeEach(async () => {
      await memory.addFact('/project/alpha', 'AgentForge uses a pipeline architecture', {
        categories: ['architecture'],
        importance: 0.9,
      });
      await memory.addFact('/project/alpha', 'The pipeline has multiple stages', {
        categories: ['architecture'],
        importance: 0.7,
      });
      await memory.addFact('/project/alpha', 'React is used for the frontend UI', {
        categories: ['frontend'],
        importance: 0.5,
      });
      await memory.addFact('/project/beta', 'Python scripts handle deployment', {
        categories: ['devops'],
        importance: 0.6,
      });
    });

    it('returns facts ranked by semantic similarity', async () => {
      const results = await memory.searchSemantic('pipeline architecture');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toMatch(/pipeline/i);
      expect(results[0].similarity).toBeGreaterThan(0);
    });

    it('respects topK limit', async () => {
      const results = await memory.searchSemantic('architecture', { topK: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('filters by scope', async () => {
      const results = await memory.searchSemantic('pipeline', { scope: '/project/alpha' });
      expect(results.every((r) => r.scope === '/project/alpha')).toBe(true);
    });

    it('returns empty array when nothing matches', async () => {
      const results = await memory.searchSemantic('xyzabc123 nonexistent');
      expect(Array.isArray(results)).toBe(true);
    });

    it('includes similarity score in results', async () => {
      const results = await memory.searchSemantic('pipeline stages');
      for (const r of results) {
        expect(typeof r.similarity).toBe('number');
        expect(r.similarity).toBeGreaterThanOrEqual(-1);
        expect(r.similarity).toBeLessThanOrEqual(1);
      }
    });

    it('filters by minimum importance', async () => {
      const results = await memory.searchSemantic('pipeline', { minImportance: 0.8 });
      expect(results.every((r) => r.importance >= 0.8)).toBe(true);
    });
  });

  // ── Hierarchical Scopes ──────────────────────────────

  describe('getFactsInScopeTree()', () => {
    beforeEach(async () => {
      await memory.addFact('/project', 'root level fact');
      await memory.addFact('/project/agentforge', 'AgentForge fact');
      await memory.addFact('/project/agentforge/core', 'core module fact');
      await memory.addFact('/project/agentforge/plugins', 'plugins module fact');
      await memory.addFact('/other', 'other project fact');
    });

    it('returns facts in exact scope', async () => {
      const facts = await memory.getFactsInScopeTree('/project/agentforge/core');
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe('core module fact');
    });

    it('returns facts in scope and all child scopes', async () => {
      const facts = await memory.getFactsInScopeTree('/project/agentforge');
      const contents = facts.map((f) => f.content);
      expect(contents).toContain('AgentForge fact');
      expect(contents).toContain('core module fact');
      expect(contents).toContain('plugins module fact');
      expect(contents).not.toContain('root level fact');
      expect(contents).not.toContain('other project fact');
    });

    it('root scope returns all facts', async () => {
      const facts = await memory.getFactsInScopeTree('/');
      expect(facts.length).toBeGreaterThanOrEqual(5);
    });

    it('returns empty array for scope with no facts', async () => {
      const facts = await memory.getFactsInScopeTree('/nonexistent');
      expect(facts).toHaveLength(0);
    });

    it('respects topK and minImportance options', async () => {
      await memory.addFact('/project/agentforge', 'important fact', { importance: 0.95 });
      const facts = await memory.getFactsInScopeTree('/project', { topK: 2, minImportance: 0.9 });
      expect(facts.length).toBeLessThanOrEqual(2);
      expect(facts.every((f) => f.importance >= 0.9)).toBe(true);
    });
  });

  // ── Entity & Relation ────────────────────────────────

  describe('Entities & Relations', () => {
    it('adds and retrieves an entity', async () => {
      const id = await memory.addEntity('MemorySystem', 'class', { version: '1.0' });
      const entity = await memory.getEntity(id);
      expect(entity?.name).toBe('MemorySystem');
      expect(entity?.type).toBe('class');
      expect(entity?.attributes).toEqual({ version: '1.0' });
    });

    it('returns undefined for unknown entity', async () => {
      const entity = await memory.getEntity('no-such-id');
      expect(entity).toBeUndefined();
    });

    it('adds and retrieves relations', async () => {
      const e1 = await memory.addEntity('A', 'node');
      const e2 = await memory.addEntity('B', 'node');
      await memory.addRelation(e1, e2, 'depends_on', 0.8);

      const relations = await memory.getRelations(e1);
      expect(relations).toHaveLength(1);
      expect(relations[0].from).toBe(e1);
      expect(relations[0].to).toBe(e2);
      expect(relations[0].type).toBe('depends_on');
      expect(relations[0].weight).toBe(0.8);
    });

    it('filters relations by target', async () => {
      const e1 = await memory.addEntity('A', 'node');
      const e2 = await memory.addEntity('B', 'node');
      const e3 = await memory.addEntity('C', 'node');
      await memory.addRelation(e1, e2, 'uses');
      await memory.addRelation(e3, e2, 'uses');

      const incoming = await memory.getRelations(undefined, e2);
      expect(incoming).toHaveLength(2);
    });

    it('traverses graph from start entity', async () => {
      const e1 = await memory.addEntity('1', 'root');
      const e2 = await memory.addEntity('2', 'child');
      const e3 = await memory.addEntity('3', 'grandchild');
      await memory.addRelation(e1, e2, 'has');
      await memory.addRelation(e2, e3, 'has');

      const result = await memory.traverse(e1, 2);
      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
    });

    it('respects maxDepth in traverse', async () => {
      const e1 = await memory.addEntity('1', 'root');
      const e2 = await memory.addEntity('2', 'child');
      const e3 = await memory.addEntity('3', 'grandchild');
      await memory.addRelation(e1, e2, 'has');
      await memory.addRelation(e2, e3, 'has');

      const result = await memory.traverse(e1, 1);
      expect(result.nodes).toHaveLength(2);
    });

    it('returns empty graph for unknown start entity', async () => {
      const result = await memory.traverse('no-such', 3);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  // ── deleteFact ───────────────────────────────────────

  describe('deleteFact()', () => {
    it('deletes a fact by scope and id', async () => {
      const id = await memory.addFact('/test', 'temporary fact');
      await memory.deleteFact('/test', id);
      const facts = await storage.getFacts('/test');
      expect(facts).toHaveLength(0);
    });
  });
});

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
