import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { requestLogger } from '../../src/middleware/logger.js';

// Helper: create a minimal Hono app with the logger middleware and a test route
function createTestApp() {
  const app = new Hono();
  app.use('*', requestLogger);
  app.get('/test', (c) => c.json({ ok: true }));
  app.get('/echo', (c) => c.json({ headers: Object.fromEntries(c.req.raw.headers) }));
  return app;
}

describe('requestLogger middleware', () => {
  const originalEnv = process.env.LOG_FORMAT;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.LOG_FORMAT = originalEnv;
  });

  describe('LOG_FORMAT=json (default)', () => {
    it('logs a JSON line with expected fields', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      const res = await app.request('/test');
      expect(res.status).toBe(200);

      const logCall = (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
      expect(logCall).toBeDefined();
      const parsed = JSON.parse(logCall as string);
      expect(parsed).toHaveProperty('ts');
      expect(parsed).toHaveProperty('method', 'GET');
      expect(parsed).toHaveProperty('path', '/test');
      expect(parsed).toHaveProperty('status', 200);
      expect(parsed).toHaveProperty('ms');
      expect(parsed).toHaveProperty('requestId');
      expect(parsed).toHaveProperty('userAgent');
      expect(typeof parsed.ts).toBe('string');
      expect(typeof parsed.ms).toBe('number');
      expect(typeof parsed.requestId).toBe('string');
    });

    it('uses the JSON format when LOG_FORMAT is unset (default)', async () => {
      delete process.env.LOG_FORMAT;
      const app = createTestApp();
      await app.request('/test');
      const logCall = (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
      expect(() => JSON.parse(logCall as string)).not.toThrow();
    });

    it('ms is a non-negative number', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      await app.request('/test');
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      expect(parsed.ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('LOG_FORMAT=pretty', () => {
    it('logs a human-readable one-liner', async () => {
      process.env.LOG_FORMAT = 'pretty';
      const app = createTestApp();
      await app.request('/test');
      const logCall = (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0]?.[0] as string;
      expect(logCall).toBeDefined();
      // Should contain method, path, status and timing
      expect(logCall).toContain('GET');
      expect(logCall).toContain('/test');
      expect(logCall).toContain('200');
      expect(logCall).toContain('ms');
    });
  });

  describe('LOG_FORMAT=silent', () => {
    it('does not log anything', async () => {
      process.env.LOG_FORMAT = 'silent';
      const app = createTestApp();
      await app.request('/test');
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('X-Request-Id', () => {
    it('generates a UUID v4 requestId when no X-Request-Id header is present', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      await app.request('/test');
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(parsed.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('passes through an existing X-Request-Id header', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      const existingId = 'existing-id-12345';
      await app.request('/test', {
        headers: { 'X-Request-Id': existingId },
      });
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      expect(parsed.requestId).toBe(existingId);
    });

    it('sets X-Request-Id response header', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      const res = await app.request('/test');
      const requestId = res.headers.get('X-Request-Id');
      expect(requestId).toBeTruthy();
      // Verify it matches the logged requestId
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      expect(requestId).toBe(parsed.requestId);
    });

    it('echoes back the same X-Request-Id in the response when present in request', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      const existingId = 'pass-through-id-999';
      const res = await app.request('/test', {
        headers: { 'X-Request-Id': existingId },
      });
      expect(res.headers.get('X-Request-Id')).toBe(existingId);
    });
  });

  describe('timing', () => {
    it('reports ms as a finite number', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      await app.request('/test');
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      expect(Number.isFinite(parsed.ms)).toBe(true);
    });
  });

  describe('userAgent', () => {
    it('captures User-Agent from the request', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      await app.request('/test', {
        headers: { 'User-Agent': 'TestAgent/1.0' },
      });
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      expect(parsed.userAgent).toBe('TestAgent/1.0');
    });

    it('reports empty string when no User-Agent header', async () => {
      process.env.LOG_FORMAT = 'json';
      const app = createTestApp();
      await app.request('/test');
      const parsed = JSON.parse(
        (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls[0][0] as string as string,
      );
      expect(parsed.userAgent).toBe('');
    });
  });
});
