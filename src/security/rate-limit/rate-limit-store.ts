/**
 * AgentForge Rate Limit Store
 */

export interface RateLimitStoreEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitStore {
  get(key: string): RateLimitStoreEntry | undefined;
  set(key: string, entry: RateLimitStoreEntry): void;
  delete(key: string): void;
  cleanupExpired(config: { windowMs: number }): void;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitStoreEntry>();

  get(key: string): RateLimitStoreEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: RateLimitStoreEntry): void {
    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  cleanupExpired(config: { windowMs: number }): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.windowStart >= config.windowMs) {
        this.store.delete(key);
      }
    }
  }
}
