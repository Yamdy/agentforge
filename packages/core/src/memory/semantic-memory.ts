import type { MemoryStorage, Fact, Entity, Relation, EmbeddingProvider, GraphResult, SearchOptions } from './types.js';

let seqCounter = 0;
function nextId(prefix: string): string {
  seqCounter++;
  return `${prefix}-${Date.now()}-${seqCounter}`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/i)
    .filter((t) => t.length >= 2);
}

function hashToken(token: string, dim: number): number {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = (h * 31 + token.charCodeAt(i)) & 0x7fffffff;
  }
  return h % dim;
}

export class SimpleEmbedder implements EmbeddingProvider {
  dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  embed(text: string): number[] {
    const vec = new Array(this.dimensions).fill(0);
    const tokens = tokenize(text);
    if (tokens.length === 0) return vec;

    for (const token of tokens) {
      const idx = hashToken(token, this.dimensions);
      vec[idx]++;
    }

    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }
    return vec;
  }
}

export interface SemanticSearchResult extends Fact {
  similarity: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
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

function scopeMatches(factScope: string, rootScope: string): boolean {
  if (rootScope === '/' || rootScope === '') return true;
  if (factScope === rootScope) return true;
  return factScope.startsWith(rootScope + '/');
}

export class SemanticMemory {
  private storage: MemoryStorage;
  private embedder: EmbeddingProvider;

  constructor(storage: MemoryStorage, embedder?: EmbeddingProvider) {
    this.storage = storage;
    this.embedder = embedder ?? new SimpleEmbedder();
  }

  async addFact(
    scope: string,
    content: string,
    options?: { categories?: string[]; importance?: number },
  ): Promise<string> {
    const id = nextId('fact');
    const now = new Date().toISOString();
    const embedding = this.embedder.embed(content);
    const fact: Fact = {
      id,
      content,
      embedding,
      scope,
      categories: options?.categories ?? [],
      importance: options?.importance ?? 0.5,
      createdAt: now,
      lastAccessed: now,
      accessCount: 1,
    };
    await this.storage.upsertFact(scope, fact);
    return id;
  }

  async searchSemantic(
    query: string,
    options?: { topK?: number; scope?: string; minImportance?: number },
  ): Promise<SemanticSearchResult[]> {
    const queryVec = this.embedder.embed(query);
    if (queryVec.every((v) => v === 0)) return [];

    let facts: Fact[];
    if (options?.scope) {
      facts = await this.storage.getFacts(options.scope);
    } else {
      // Collect facts from all known scopes — we use the storage's searchFacts
      // with a broad query to get candidates, then re-rank with embedding
      facts = await this.storage.searchFacts('', { topK: 500 });
    }

    const results: SemanticSearchResult[] = [];
    for (const fact of facts) {
      if (options?.minImportance !== undefined && fact.importance < options.minImportance) continue;
      const factVec = fact.embedding;
      if (!factVec || factVec.length === 0) continue;
      const similarity = cosineSimilarity(queryVec, factVec);
      if (similarity <= 0) continue;
      results.push({ ...fact, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    const topK = options?.topK ?? 10;
    return results.slice(0, topK);
  }

  async getFactsInScopeTree(rootScope: string, options?: SearchOptions): Promise<Fact[]> {
    // Fetch all facts, then filter by hierarchical scope
    const facts = await this.storage.searchFacts('', { topK: 1000 });

    // Filter for hierarchical scope: include facts whose scope is rootScope or a child
    let filtered = facts.filter((f) => scopeMatches(f.scope, rootScope));

    if (options?.minImportance !== undefined) {
      const minImp = options.minImportance;
      filtered = filtered.filter((f) => f.importance >= minImp);
    }

    filtered.sort((a, b) => b.importance - a.importance);
    if (options?.topK !== undefined) {
      filtered = filtered.slice(0, options.topK);
    }
    return filtered;
  }

  async deleteFact(scope: string, id: string): Promise<void> {
    await this.storage.deleteFact(scope, id);
  }

  async addEntity(
    name: string,
    type: string,
    attributes?: Record<string, unknown>,
  ): Promise<string> {
    const id = nextId('ent');
    const entity: Entity = { id, name, type, attributes: attributes ?? {} };
    await this.storage.upsertEntity(entity);
    return id;
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return this.storage.getEntity(id);
  }

  async addRelation(
    from: string,
    to: string,
    type: string,
    weight = 1.0,
  ): Promise<void> {
    await this.storage.upsertRelation({ from, to, type, weight });
  }

  async getRelations(from?: string, to?: string): Promise<Relation[]> {
    return this.storage.getRelations(from, to);
  }

  async traverse(startId: string, maxDepth = 5): Promise<GraphResult> {
    const startEntity = await this.storage.getEntity(startId);
    if (!startEntity) return { nodes: [], edges: [] };

    const visited = new Set<string>();
    const nodes: Entity[] = [];
    const edges: Relation[] = [];
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      const entity = await this.storage.getEntity(current.id);
      if (entity) nodes.push(entity);

      if (current.depth < maxDepth) {
        const relations = await this.storage.getRelations(current.id);
        for (const rel of relations) {
          edges.push(rel);
          if (!visited.has(rel.to)) {
            queue.push({ id: rel.to, depth: current.depth + 1 });
          }
        }
      }
    }

    return { nodes, edges };
  }
}
