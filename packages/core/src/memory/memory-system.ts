import type {
  MemoryStorage,
  WorkingMemory,
  Fact,
  MemoryEntry,
  RememberOptions,
  RecallOptions,
} from './types.js';
import { EpisodicMemory } from './episodic-memory.js';
import { SemanticMemory } from './semantic-memory.js';

function computeRecency(timestamp: string): number {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, 1 - ageMs / maxAgeMs);
}

function compositeScore(semanticSimilarity: number, recency: number, importance: number): number {
  return 0.5 * semanticSimilarity + 0.3 * recency + 0.2 * importance;
}

export interface MemorySystemOptions {
  storage: MemoryStorage;
}

export class MemorySystem {
  private storage: MemoryStorage;
  private episodic: EpisodicMemory;
  private semantic: SemanticMemory;
  private knownScopes = new Set<string>();

  constructor(options: MemorySystemOptions) {
    this.storage = options.storage;
    this.episodic = new EpisodicMemory(this.storage);
    this.semantic = new SemanticMemory(this.storage);
  }

  // ── remember() ─────────────────────────────────────────────

  async remember(
    content: string,
    options: RememberOptions = {},
  ): Promise<string> {
    const type = options.type ?? 'fact';

    if (type === 'event') {
      const scope = options.scope ?? 'default';
      this.knownScopes.add(scope);
      return this.episodic.addEvent(scope, content, {
        importance: options.importance,
      });
    }

    const scope = options.scope ?? '/default';
    this.knownScopes.add(scope);
    return this.semantic.addFact(scope, content, {
      categories: options.categories ?? [],
      importance: options.importance ?? 0.5,
    });
  }

  // ── recall() ───────────────────────────────────────────────

  async recall(
    query: string,
    options: RecallOptions = {},
  ): Promise<MemoryEntry[]> {
    const { topK = 10, scope, timeRange } = options;
    const results: MemoryEntry[] = [];

    // Search facts via SemanticMemory (semantic similarity)
    const semanticResults = await this.semantic.searchSemantic(query, {
      topK: topK * 2,
      scope,
    });
    for (const sr of semanticResults) {
      const recency = computeRecency(sr.lastAccessed);
      results.push({
        id: sr.id,
        content: sr.content,
        type: 'fact',
        score: compositeScore(sr.similarity, recency, sr.importance),
        importance: sr.importance,
        timestamp: sr.createdAt,
      });
    }

    // Search events via EpisodicMemory
    const eventScopes = scope ? [scope] : [...this.knownScopes];
    for (const s of eventScopes) {
      const events = await this.episodic.query(s, { timeRange, limit: topK });
      for (const e of events) {
        if (e.content.toLowerCase().includes(query.toLowerCase())) {
          const recency = computeRecency(e.timestamp);
          results.push({
            id: e.id,
            content: e.content,
            type: 'event',
            score: compositeScore(1, recency, e.importance),
            importance: e.importance,
            timestamp: e.timestamp,
          });
        }
      }
    }

    // Aggregate scores for duplicate content
    const aggregated = new Map<string, MemoryEntry>();
    for (const r of results) {
      const key = r.content.toLowerCase();
      const existing = aggregated.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, r.score);
        existing.importance = Math.max(existing.importance, r.importance);
      } else {
        aggregated.set(key, { ...r });
      }
    }

    const sorted = [...aggregated.values()].sort((a, b) => b.score - a.score);
    return sorted.slice(0, topK);
  }

  // ── forget() ───────────────────────────────────────────────

  async forget(id: string): Promise<boolean> {
    for (const scope of this.knownScopes) {
      try {
        await this.storage.deleteFact(scope, id);
        return true;
      } catch {
        // continue trying other scopes
      }
    }
    return false;
  }

  // ── Working Memory ─────────────────────────────────────────

  async getWorkingMemory(scope: string): Promise<WorkingMemory | undefined> {
    return this.storage.getWorkingMemory(scope);
  }

  async updateWorkingMemory(
    scope: string,
    updates: Partial<Pick<WorkingMemory, 'userProfile' | 'taskState'>>,
  ): Promise<void> {
    const existing = await this.storage.getWorkingMemory(scope);
    if (!existing) return;

    const updated: WorkingMemory = {
      ...existing,
      userProfile: updates.userProfile
        ? { ...existing.userProfile, ...updates.userProfile }
        : existing.userProfile,
      taskState: updates.taskState
        ? { ...existing.taskState, ...updates.taskState }
        : existing.taskState,
    };
    await this.storage.setWorkingMemory(scope, updated);
  }
}
