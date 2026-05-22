import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware, resetRateLimitStores } from '../../src/middleware/rate-limit.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createApp(opts?: Parameters<typeof rateLimitMiddleware>[0]) {
  const app = new Hono();
  app.use('*', rateLimitMiddleware(opts));
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));
  app.get('/other', (c) => c.json({ ok: true }));
  app.get('/error', (c) => c.json({ error: 'bad' }, 500) as Response);
  return app;
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    resetRateLimitStores();
  });

  it('adds X-RateLimit headers to responses', async () => {
    const app = createApp({ maxRequests: 10 });
    const res = await app.request('/test');

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('returns 429 with JSON body and rate-limit headers when limit is exceeded', async () => {
    const app = createApp({ maxRequests: 2 });

    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(200);

    const res = await app.request('/test');
    expect(res.status).toBe(429);

    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error', 'Too Many Requests');
    expect(body).toHaveProperty('retryAfter');
    expect(typeof body.retryAfter).toBe('number');

    // Verify rate-limit headers on 429 (B1-7)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('2');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('X-RateLimit-Remaining decreases with each request', async () => {
    const app = createApp({ maxRequests: 5 });

    const res1 = await app.request('/test');
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4');

    const res2 = await app.request('/test');
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('3');
  });

  it('X-RateLimit-Remaining is 0 on the limiting request', async () => {
    const app = createApp({ maxRequests: 2 });

    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).headers.get('X-RateLimit-Remaining')).toBe('0');

    const res = await app.request('/test');
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('sliding window evicts old entries after windowMs elapses', async () => {
    const app = createApp({ windowMs: 80, maxRequests: 2 });

    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(200);
    // Third request should be rate limited
    expect((await app.request('/test')).status).toBe(429);

    // Wait for the window to slide past the oldest entry
    await new Promise((r) => setTimeout(r, 120));

    // Should succeed again
    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('different IPs have independent counters', async () => {
    const app = createApp({ maxRequests: 1 });

    const res1 = await app.request('/test', { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    expect(res1.status).toBe(200);

    // Same IP should be blocked
    const res2 = await app.request('/test', { headers: { 'X-Forwarded-For': '1.2.3.4' } });
    expect(res2.status).toBe(429);

    // Different IP should be allowed
    const res3 = await app.request('/test', { headers: { 'X-Forwarded-For': '5.6.7.8' } });
    expect(res3.status).toBe(200);
  });

  it('different HTTP methods on same path are separate counters', async () => {
    const app = createApp({ maxRequests: 1 });

    // GET uses its own counter
    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(429);

    // POST has its own counter
    const postRes = await app.request('/test', { method: 'POST' });
    expect(postRes.status).toBe(200);
  });

  it('different routes have independent counters', async () => {
    const app = createApp({ maxRequests: 1 });

    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(429);

    // Different route is unaffected
    expect((await app.request('/other')).status).toBe(200);
  });

  it('skipFailedRequests: error responses do not decrement remaining on the same route', async () => {
    const app = createApp({ maxRequests: 5, skipFailedRequests: true });

    // Error responses do not consume tokens on their own route
    const res1 = await app.request('/error');
    expect(res1.status).toBe(500);
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('5');

    const res2 = await app.request('/error');
    expect(res2.status).toBe(500);
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('5');
  });

  it('skipFailedRequests=false (default): error responses are counted', async () => {
    const app = createApp({ maxRequests: 1, skipFailedRequests: false });

    // Error request on /error counts against the /error counter
    expect((await app.request('/error')).status).toBe(500);

    // Next request on the same route should be rate limited
    const res = await app.request('/error');
    expect(res.status).toBe(429);
  });

  it('accepts custom maxRequests', async () => {
    const app = createApp({ maxRequests: 3 });

    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(429);
  });

  it('accepts custom windowMs', async () => {
    const app = createApp({ windowMs: 40, maxRequests: 1 });

    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(429);

    await new Promise((r) => setTimeout(r, 60));

    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('falls through the IP resolution chain when no forwarding headers are present', async () => {
    const app = createApp({ maxRequests: 1 });

    // Request without any IP header uses "unknown"
    expect((await app.request('/test')).status).toBe(200);
    expect((await app.request('/test')).status).toBe(429);
  });
});
