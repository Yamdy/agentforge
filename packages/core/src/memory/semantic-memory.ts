import type { MemoryStorage, Fact, Entity, Relation, EmbeddingProvider, GraphResult, SearchOptions } from './types.js';

let seqCounter = 0;
function nextId(prefix: string): string {
  seqCounter++;
  return `${prefix}-${Date.now()}-${seqCounter}`;
}

export class SimpleEmbedder implements EmbeddingProvider {
  dimensions: number;

  constructor(dimensions = 256) {
    this.dimensions = dimensions;
  }

  embed(_text: string): number[] {
    return new Array(this.dimensions).fill(0);
  }
}

export interface SemanticSearchResult extends Fact {
  similarity: number;
}

export class SemanticMemory {
  private storage: MemoryStorage;
  private embedder: EmbeddingProvider;

  constructor(storage: MemoryStorage, embedder?: EmbeddingProvider) {
    this.storage = storage;
    this.embedder = embedder ?? new SimpleEmbedder();
  }

  async addFact(
    _scope: string,
    _content: string,
    _options?: { categories?: string[]; importance?: number },
  ): Promise<string> {
    return '';
  }

  async searchSemantic(
    _query: string,
    _options?: { topK?: number; scope?: string; minImportance?: number },
  ): Promise<SemanticSearchResult[]> {
    return [];
  }

  async getFactsInScopeTree(_rootScope: string, _options?: SearchOptions): Promise<Fact[]> {
    return [];
  }

  async deleteFact(_scope: string, _id: string): Promise<void> {}

  async addEntity(_name: string, _type: string, _attributes?: Record<string, unknown>): Promise<string> {
    return '';
  }

  async getEntity(_id: string): Promise<Entity | undefined> {
    return undefined;
  }

  async addRelation(_from: string, _to: string, _type: string, _weight?: number): Promise<void> {}

  async getRelations(_from?: string, _to?: string): Promise<Relation[]> {
    return [];
  }

  async traverse(_startId: string, _maxDepth?: number): Promise<GraphResult> {
    return { nodes: [], edges: [] };
  }
}
