import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentForgeServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// CORS tests
// ---------------------------------------------------------------------------

describe('CORS middleware', () => {
  it('adds CORS headers to responses when cors option is enabled', async () => {
    const server = new AgentForgeServer({
      port: 0,
      cors: { origin: 'https://example.com' },
    });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`, {
        headers: { 'Origin': 'https://example.com' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    } finally {
      await handle.close();
    }
  });

  it('responds to OPTIONS preflight with CORS headers', async () => {
    const server = new AgentForgeServer({
      port: 0,
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST');
    } finally {
      await handle.close();
    }
  });

  it('does not add CORS headers when cors option is not set', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Request timeout tests
// ---------------------------------------------------------------------------

describe('Request timeout', () => {
  it('sets requestTimeout on the HTTP server', async () => {
    const server = new AgentForgeServer({ port: 0, requestTimeout: 5000 });
    const handle = await server.start();
    try {
      // Fast request should succeed
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('uses default requestTimeout when not specified', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown tests
// ---------------------------------------------------------------------------

describe('Graceful shutdown', () => {
  it('stop() waits for in-flight requests to complete', async () => {
    const server = new AgentForgeServer({ port: 0 });
    let requestStarted = false;
    let requestCompleted = false;

    server.hono.get('/inflight', async (c) => {
      requestStarted = true;
      await new Promise(r => setTimeout(r, 100));
      requestCompleted = true;
      return c.json({ ok: true });
    });

    const handle = await server.start();

    // Start a request
    const reqPromise = fetch(`http://127.0.0.1:${handle.port}/inflight`);

    // Wait for the request to be received by the server
    await vi.waitFor(() => expect(requestStarted).toBe(true));

    // Initiate shutdown while request is in-flight
    const stopPromise = server.stop();

    // Wait for both
    const res = await reqPromise;
    expect(res.status).toBe(200);
    expect(requestCompleted).toBe(true);

    await stopPromise;
  });

  it('stop() with shutdownTimeout forces close after timeout', async () => {
    const server = new AgentForgeServer({ port: 0, shutdownTimeout: 50 });
    let requestStarted = false;

    server.hono.get('/stuck', async (c) => {
      requestStarted = true;
      await new Promise(r => setTimeout(r, 5000));
      return c.json({ ok: true });
    });

    const handle = await server.start();

    // Start a request
    const reqPromise = fetch(`http://127.0.0.1:${handle.port}/stuck`).catch(() => null);
    await vi.waitFor(() => expect(requestStarted).toBe(true));

    // stop should complete within shutdownTimeout + some margin
    const start = Date.now();
    await server.stop();
    const elapsed = Date.now() - start;
    // Should have timed out well before the 5000ms request finishes
    expect(elapsed).toBeLessThan(2000);

    await reqPromise;
  });
});
