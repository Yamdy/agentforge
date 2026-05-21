import type {
  MemoryStorage,
  WorkingMemory,
  MemoryEvent,
  Fact,
  MemoryEntry,
  RememberOptions,
  RecallOptions,
} from './types.js';

let seqCounter = 0;
function nextId(): string {
  seqCounter++;
  return `mem-${Date.now()}-${seqCounter}`;
}

export interface MemorySystemOptions {
  storage: MemoryStorage;
}

export class MemorySystem {
  private storage: MemoryStorage;
  private knownScopes = new Set<string>();

  constructor(options: MemorySystemOptions) {
    this.storage = options.storage;
  }

  // ── remember() ─────────────────────────────────────────────

  async remember(
    content: string,
    options: RememberOptions = {},
  ): Promise<string> {
    const id = nextId();
    const now = new Date().toISOString();
    const type = options.type ?? 'fact';

    if (type === 'event') {
      const event: MemoryEvent = {
        id,
        timestamp: now,
        type: 'user_input',
        content,
        importance: options.importance ?? 0.5,
      };
      const scope = options.scope ?? 'default';
      this.knownScopes.add(scope);
      await this.storage.appendEvent(scope, event);
      return id;
    }

    const fact: Fact = {
      id,
      content,
      scope: options.scope ?? '/default',
      categories: options.categories ?? [],
      importance: options.importance ?? 0.5,
      createdAt: now,
      lastAccessed: now,
      accessCount: 1,
    };
    this.knownScopes.add(fact.scope);
    await this.storage.upsertFact(fact.scope, fact);
    return id;
  }

  // ── recall() ───────────────────────────────────────────────

  async recall(
    query: string,
    options: RecallOptions = {},
  ): Promise<MemoryEntry[]> {
    const { topK = 10, scope } = options;
    const results: MemoryEntry[] = [];

    // Search facts across all known scopes (or scoped)
    const searchScope = scope;
    const facts = await this.storage.searchFacts(query, { topK, scope: searchScope });
    for (const f of facts) {
      results.push({
        id: f.id,
        content: f.content,
        type: 'fact',
        score: f.importance,
        timestamp: f.createdAt,
      });
    }

    // Search events in relevant scopes
    const eventScopes = scope ? [scope] : [...this.knownScopes];
    for (const s of eventScopes) {
      const events = await this.storage.getEvents(s, { limit: topK });
      for (const e of events) {
        if (e.content.toLowerCase().includes(query.toLowerCase())) {
          results.push({
            id: e.id,
            content: e.content,
            type: 'event',
            score: e.importance,
            timestamp: e.timestamp,
          });
        }
      }
    }

    // Sort by score descending, then slice to topK
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
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
