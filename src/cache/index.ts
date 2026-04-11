export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ToolCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private cleanupCount = 0;
  private readonly CLEANUP_INTERVAL = 100;

  set(key: string, value: unknown, ttlMs: number = 300000): void {
    this.maybeCleanup();
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | undefined {
    this.maybeCleanup();
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

  private maybeCleanup(): void {
    this.cleanupCount++;
    if (this.cleanupCount >= this.CLEANUP_INTERVAL) {
      this.cleanupCount = 0;
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
        }
      }
    }
  }
}

export const toolCache = new ToolCache();
