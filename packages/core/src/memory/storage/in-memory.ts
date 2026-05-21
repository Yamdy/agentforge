import type {
  MemoryStorage,
  WorkingMemory,
  MemoryEvent,
  EventQuery,
  Fact,
  SearchOptions,
  Entity,
  Relation,
} from '../types.js';

export class InMemoryStore implements MemoryStorage {
  private workingMemory = new Map<string, WorkingMemory>();
  private events = new Map<string, MemoryEvent[]>();
  private facts = new Map<string, Map<string, Fact>>();
  private entities = new Map<string, Entity>();
  private relations: Relation[] = [];

  // ── Working Memory ──────────────────────────────────────────

  async getWorkingMemory(scope: string): Promise<WorkingMemory | undefined> {
    return this.workingMemory.get(scope);
  }

  async setWorkingMemory(scope: string, memory: WorkingMemory): Promise<void> {
    this.workingMemory.set(scope, memory);
  }

  // ── Episodic Memory ─────────────────────────────────────────

  async appendEvent(scope: string, event: MemoryEvent): Promise<void> {
    const list = this.events.get(scope) ?? [];
    list.push(event);
    this.events.set(scope, list);
  }

  async getEvents(scope: string, query?: EventQuery): Promise<MemoryEvent[]> {
    let list = this.events.get(scope) ?? [];
    if (!query) return [...list];

    if (query.timeRange) {
      const { start, end } = query.timeRange;
      list = list.filter((e) => e.timestamp >= start && e.timestamp <= end);
    }
    if (query.minImportance !== undefined) {
      const minImp = query.minImportance;
      list = list.filter((e) => e.importance >= minImp);
    }
    if (query.types && query.types.length > 0) {
      list = list.filter((e) => query.types!.includes(e.type));
    }
    if (query.limit !== undefined) {
      list = list.slice(0, query.limit);
    }
    return [...list];
  }

  // ── Semantic Memory ─────────────────────────────────────────

  async upsertFact(scope: string, fact: Fact): Promise<void> {
    let scopeMap = this.facts.get(scope);
    if (!scopeMap) {
      scopeMap = new Map();
      this.facts.set(scope, scopeMap);
    }
    scopeMap.set(fact.id, { ...fact });
  }

  async getFacts(scope: string, query?: SearchOptions): Promise<Fact[]> {
    const scopeMap = this.facts.get(scope);
    if (!scopeMap) return [];
    let results = [...scopeMap.values()];
    if (query?.minImportance !== undefined) {
      const minImp = query.minImportance;
      results = results.filter((f) => f.importance >= minImp);
    }
    if (query?.topK !== undefined) {
      results = results.slice(0, query.topK);
    }
    return results;
  }

  async searchFacts(query: string, options?: SearchOptions): Promise<Fact[]> {
    const q = query.toLowerCase();
    let results: Fact[] = [];
    for (const scopeMap of this.facts.values()) {
      for (const fact of scopeMap.values()) {
        if (fact.content.toLowerCase().includes(q)) {
          results.push(fact);
        }
      }
    }
    if (options?.scope) {
      results = results.filter((f) => f.scope === options.scope);
    }
    if (options?.minImportance !== undefined) {
      const minImp = options.minImportance;
      results = results.filter((f) => f.importance >= minImp);
    }
    if (options?.topK !== undefined) {
      results = results.slice(0, options.topK);
    }
    return results;
  }

  async deleteFact(scope: string, factId: string): Promise<void> {
    const scopeMap = this.facts.get(scope);
    if (scopeMap) {
      scopeMap.delete(factId);
    }
  }

  // ── Entity & Relation ───────────────────────────────────────

  async upsertEntity(entity: Entity): Promise<void> {
    this.entities.set(entity.id, { ...entity });
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return this.entities.get(id);
  }

  async upsertRelation(relation: Relation): Promise<void> {
    const existing = this.relations.findIndex(
      (r) => r.from === relation.from && r.to === relation.to && r.type === relation.type,
    );
    if (existing >= 0) {
      this.relations[existing] = { ...relation };
    } else {
      this.relations.push({ ...relation });
    }
  }

  async getRelations(from?: string, to?: string): Promise<Relation[]> {
    let results = [...this.relations];
    if (from) results = results.filter((r) => r.from === from);
    if (to) results = results.filter((r) => r.to === to);
    return results;
  }
}
