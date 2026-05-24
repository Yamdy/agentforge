import type { Context, Next } from 'hono';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function rateLimitMiddleware(options?: { windowMs?: number; limit?: number }) {
  const windowMs = options?.windowMs ?? 60000;
  const limit = options?.limit ?? 100;

  return async (c: Context, next: Next) => {
    const now = Date.now();

    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) {
        rateLimitMap.delete(key);
      }
    }

    const ip = c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || 'unknown';
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (record.count >= limit) {
      return c.json({ error: { code: 'RATE_LIMIT', message: 'Too many requests' } }, 429);
    }

    record.count++;
    await next();
  };
}
