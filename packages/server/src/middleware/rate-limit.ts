import type { MiddlewareHandler } from 'hono';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Time window in milliseconds (default: 60 000 = 1 minute). */
  windowMs?: number;
  /** Maximum number of requests within the window (default: 100). */
  maxRequests?: number;
  /**
   * When true, requests that result in a 4xx or 5xx response do not count
   * against the rate limit (default: false).
   */
  skipFailedRequests?: boolean;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const stores = new Map<string, RateLimitEntry>();

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map key from IP + method + path.
 *
 * Uses \x00 (null byte) as the internal separator so that IPv6 addresses
 * (which contain colons) do not create ambiguity.
 */
function buildKey(ip: string, method: string, path: string): string {
  return `${ip}\x00${method}\x00${path}`;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter keyed by IP + method + route path.
 *
 * Returns a Hono `MiddlewareHandler` that injects standard
 * `X-RateLimit-*` response headers and returns a 429 JSON body when
 * the request count exceeds the configured limit.
 */
export function rateLimitMiddleware(options?: RateLimitOptions): MiddlewareHandler {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const skipFailedRequests = options?.skipFailedRequests ?? false;

  return async (c, next) => {
    // --- resolve client key --------------------------------------------------
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c.req.raw as any)?.socket?.remoteAddress ??
      'unknown';
    const key = buildKey(ip, c.req.method, c.req.path);
    const now = Date.now();

    // --- fetch / create entry ------------------------------------------------
    let entry = stores.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      stores.set(key, entry);
    }

    // --- prune stale timestamps (sliding window) -----------------------------
    const cutoff = now - windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    // --- clean up empty entries to prevent unbounded Map growth --------------
    if (entry.timestamps.length === 0) {
      stores.delete(key);
      // Re-create so we can push below (avoids re-fetch on next request)
      entry = { timestamps: [] };
      stores.set(key, entry);
    }

    // --- check limit ---------------------------------------------------------
    if (entry.timestamps.length >= maxRequests) {
      const oldest = entry.timestamps[0]!;
      const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);

      return c.json(
        { error: 'Too Many Requests', retryAfter },
        429,
        {
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil((oldest + windowMs) / 1000)),
        },
      );
    }

    // --- record request ------------------------------------------------------
    entry.timestamps.push(now);

    try {
      await next();
    } finally {
      // --- optional: undo counting for failed responses ----------------------
      if (skipFailedRequests && c.res && c.res.status >= 400) {
        const idx = entry.timestamps.indexOf(now);
        if (idx !== -1) {
          entry.timestamps.splice(idx, 1);
        }
      }

      // --- set response headers ------------------------------------------------
      // guard: when next() throws c.res may be null (handled by onError)
      if (c.res) {
        const remaining = Math.max(0, maxRequests - entry.timestamps.length);
        const nextReset =
          entry.timestamps.length > 0
            ? entry.timestamps[0]! + windowMs
            : now + windowMs;

        c.res.headers.set('X-RateLimit-Limit', String(maxRequests));
        c.res.headers.set('X-RateLimit-Remaining', String(remaining));
        c.res.headers.set('X-RateLimit-Reset', String(Math.ceil(nextReset / 1000)));
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Testing helper
// ---------------------------------------------------------------------------

/**
 * Reset all in-memory rate-limit state.  Call in `beforeEach` when tests
 * share a single module scope.
 */
export function resetRateLimitStores(): void {
  stores.clear();
}
