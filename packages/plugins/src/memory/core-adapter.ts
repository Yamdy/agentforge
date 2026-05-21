import type { MemoryStorage, Fact } from '@primo-ai/core';
import type { MemoryBackend, MemoryEntry } from './backend.js';

const ROLE_TO_CATEGORY: Record<string, string> = {
  user: 'role:user',
  assistant: 'role:assistant',
  system: 'role:system',
};

function generateId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function entryToFact(sessionId: string, entry: MemoryEntry): Fact {
  return {
    id: generateId(),
    content: entry.content,
    scope: sessionId,
    categories: [ROLE_TO_CATEGORY[entry.role] ?? 'role:unknown'],
    importance: 0.5,
    createdAt: entry.timestamp,
    lastAccessed: entry.timestamp,
    accessCount: 0,
    embedding: undefined,
  };
}

function factToEntry(fact: Fact): MemoryEntry {
  const roleCat = fact.categories.find((c) => c.startsWith('role:'));
  const role = (roleCat?.replace('role:', '') ?? 'system') as MemoryEntry['role'];
  return {
    role,
    content: fact.content,
    timestamp: fact.createdAt,
  };
}

export interface CoreMemoryBackendOptions {
  storage: MemoryStorage;
}

export class CoreMemoryBackend implements MemoryBackend {
  private storage: MemoryStorage;
  private knownScopes = new Set<string>();

  constructor(options: CoreMemoryBackendOptions) {
    this.storage = options.storage;
  }

  async store(sessionId: string, entry: MemoryEntry): Promise<void> {
    this.knownScopes.add(sessionId);
    const fact = entryToFact(sessionId, entry);
    await this.storage.upsertFact(sessionId, fact);
  }

  async retrieve(sessionId: string, query?: { limit?: number; since?: string }): Promise<MemoryEntry[]> {
    const facts = await this.storage.getFacts(sessionId);
    let results = facts.map(factToEntry);

    if (query?.since) {
      results = results.filter((e) => e.timestamp > query.since!);
    }

    results.sort((a, b) => {
      if (a.timestamp > b.timestamp) return -1;
      if (a.timestamp < b.timestamp) return 1;
      return 0;
    });

    if (query?.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]> {
    const facts = await this.storage.searchFacts(query);
    const results = facts.map(factToEntry);
    return options?.limit ? results.slice(0, options.limit) : results;
  }

  async deleteEntries(sessionId: string, predicate: (entry: MemoryEntry) => boolean): Promise<number> {
    const facts = await this.storage.getFacts(sessionId);
    const entries = facts.map(factToEntry);
    let count = 0;
    for (let i = 0; i < entries.length; i++) {
      if (predicate(entries[i])) {
        await this.storage.deleteFact(sessionId, facts[i].id);
        count++;
      }
    }
    return count;
  }

  async deleteEntriesGlobally(predicate: (entry: MemoryEntry) => boolean): Promise<number> {
    let count = 0;
    for (const scope of this.knownScopes) {
      count += await this.deleteEntries(scope, predicate);
    }
    return count;
  }
}
