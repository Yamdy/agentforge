export interface MemoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryBackend {
  store(sessionId: string, entry: MemoryEntry): Promise<void>;
  retrieve(sessionId: string, query?: { limit?: number; since?: string }): Promise<MemoryEntry[]>;
  search(query: string, options?: { limit?: number }): Promise<MemoryEntry[]>;
  deleteEntries(sessionId: string, predicate: (entry: MemoryEntry) => boolean): Promise<number>;
}
