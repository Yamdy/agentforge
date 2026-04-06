export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ToolCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  set(key: string, value: unknown, ttlMs: number = 300000): void {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
}

export const toolCache = new ToolCache();
