/**
 * AgentForge Rate Limiter
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface MultiDimensionalRateLimit {
  perSession: RateLimitConfig;
  perTool: Record<string, RateLimitConfig>;
  global: RateLimitConfig;
}

export const DEFAULT_RATE_LIMITS: MultiDimensionalRateLimit = {
  perSession: { maxRequests: 100, windowMs: 60000 },
  perTool: {},
  global: { maxRequests: 1000, windowMs: 60000 },
};

export interface RateLimiter {
  check(key: string, config: RateLimitConfig): boolean;
  consume(key: string, config: RateLimitConfig): void;
  reset(key: string): void;
}

export class InMemoryRateLimiter implements RateLimiter {
  private entries = new Map<string, { count: number; windowStart: number }>();

  check(key: string, config: RateLimitConfig): boolean {
    this.cleanup(key, config);
    const entry = this.entries.get(key);
    return entry ? entry.count < config.maxRequests : true;
  }

  consume(key: string, config: RateLimitConfig): void {
    this.cleanup(key, config);
    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, { count: 1, windowStart: Date.now() });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private cleanup(key: string, config: RateLimitConfig): void {
    const entry = this.entries.get(key);
    if (entry && Date.now() - entry.windowStart >= config.windowMs) {
      this.entries.delete(key);
    }
  }
}
