import type { MemoryBackend, MemoryEntry } from './backend.js';

export class InMemoryBackend implements MemoryBackend {
  private entries = new Map<string, MemoryEntry[]>();

  async store(sessionId: string, entry: MemoryEntry): Promise<void> {
    let list = this.entries.get(sessionId);
    if (!list) {
      list = [];
      this.entries.set(sessionId, list);
    }
    list.push(entry);
  }

  async retrieve(sessionId: string, query?: { limit?: number; since?: string }): Promise<MemoryEntry[]> {
    const list = this.entries.get(sessionId);
    if (!list) return [];

    let results = [...list];
    if (query?.since) {
      results = results.filter((e) => e.timestamp > query.since!);
    }
    if (query?.limit) {
      results = results.slice(-query.limit);
    }
    return results;
  }

  async search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]> {
    const all: MemoryEntry[] = [];
    for (const list of this.entries.values()) {
      all.push(...list);
    }
    const results = all.filter((e) => e.content.toLowerCase().includes(query.toLowerCase()));
    return options?.limit ? results.slice(-options.limit) : results;
  }
}
