import type {
  MemoryStorage,
  WorkingMemory,
  MemoryEntry,
  RememberOptions,
  RecallOptions,
  ConsolidationResult,
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BASE_INTERVAL_DAYS = 7;

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

  // ── consolidate() ──────────────────────────────────────────

  async consolidate(options?: {
    scope?: string;
    dedupThreshold?: number;
    strategy?: 'keep_latest' | 'merge';
  }): Promise<ConsolidationResult> {
    const scope = options?.scope ?? '/';
    const threshold = options?.dedupThreshold ?? 0.85;
    const strategy = options?.strategy ?? 'keep_latest';

    const facts = await this.storage.getFacts(scope);
    if (facts.length < 2) return { deduped: 0, merged: 0, forgotten: 0, newFacts: 0 };

    let deduped = 0;
    let merged = 0;
    const deleted = new Set<string>();

    for (let i = 0; i < facts.length; i++) {
      if (deleted.has(facts[i].id)) continue;
      for (let j = i + 1; j < facts.length; j++) {
        if (deleted.has(facts[j].id)) continue;
        const embA = facts[i].embedding;
        const embB = facts[j].embedding;
        if (!embA || !embB || embA.length === 0 || embB.length === 0) continue;

        const similarity = cosineSimilarity(embA, embB);
        if (similarity < threshold) continue;

        if (strategy === 'merge') {
          const newer = facts[i].lastAccessed >= facts[j].lastAccessed ? facts[i] : facts[j];
          const older = newer === facts[i] ? facts[j] : facts[i];
          const combinedContent =
            newer.content.length >= older.content.length
              ? newer.content
              : older.content;
          await this.storage.upsertFact(scope, {
            ...newer,
            content: combinedContent,
            importance: Math.max(facts[i].importance, facts[j].importance),
            categories: [...new Set([...facts[i].categories, ...facts[j].categories])],
          });
          await this.storage.deleteFact(scope, older.id);
          deleted.add(older.id);
          merged++;
        } else {
          const older = facts[i].lastAccessed <= facts[j].lastAccessed ? facts[i] : facts[j];
          await this.storage.deleteFact(scope, older.id);
          deleted.add(older.id);
          deduped++;
        }
      }
    }

    return { deduped, merged, forgotten: 0, newFacts: 0 };
  }

  // ── Retention (Ebbinghaus) ──────────────────────────────────

  computeRetention(lastAccessed: string, accessCount: number): number {
    const elapsedDays = (Date.now() - new Date(lastAccessed).getTime()) / MS_PER_DAY;
    const effectiveInterval = BASE_INTERVAL_DAYS * Math.max(accessCount, 1);
    return Math.max(0, Math.min(1, Math.exp(-elapsedDays / effectiveInterval)));
  }

  // ── forgetStale() ───────────────────────────────────────────

  async forgetStale(options?: {
    scope?: string;
    retentionThreshold?: number;
  }): Promise<number> {
    const scope = options?.scope ?? '/';
    const threshold = options?.retentionThreshold ?? 0.1;

    const facts = await this.storage.getFacts(scope);
    let removed = 0;
    for (const fact of facts) {
      const retention = this.computeRetention(fact.lastAccessed, fact.accessCount);
      if (retention < threshold) {
        await this.storage.deleteFact(scope, fact.id);
        removed++;
      }
    }
    return removed;
  }

  // ── reflect() ──────────────────────────────────────────────

  async reflect(options?: {
    scope: string;
    timeRange?: { start: string; end: string };
  }): Promise<ConsolidationResult> {
    const scope = options?.scope ?? 'session-1';
    const events = await this.episodic.query(scope, {
      timeRange: options?.timeRange,
      limit: 500,
    });

    if (events.length === 0) return { deduped: 0, merged: 0, forgotten: 0, newFacts: 0 };

    const combined = events.map((e) => e.content).join('\n');
    const factScope = scope.startsWith('/') ? scope : `/${scope}`;

    const summaryFact = combined.length > 500
      ? combined.slice(0, 497) + '...'
      : combined;

    await this.semantic.addFact(factScope, summaryFact, {
      importance: Math.max(...events.map((e) => e.importance)),
    });

    return { deduped: 0, merged: 0, forgotten: 0, newFacts: 1 };
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
