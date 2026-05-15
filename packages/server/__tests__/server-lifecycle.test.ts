import { describe, it, expect } from 'vitest';
import { AgentForgeServer } from '../src/server.js';

describe('AgentForgeServer lifecycle', () => {
  it('start returns port and close function', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const handle = await server.start();
    expect(handle.port).toBeTypeOf('number');
    expect(handle.close).toBeTypeOf('function');
    await handle.close();
  });

  it('stop gracefully shuts down the server', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const handle = await server.start();
    await server.stop();
    // After stop, requests should fail
    const res = await fetch(`http://127.0.0.1:${handle.port}/health`).catch(() => null);
    expect(res).toBeNull();
  });
});

describe('Error middleware', () => {
  it('returns JSON error on unhandled exception', async () => {
    const server = new AgentForgeServer({ port: 0 });
    // Register a route that throws
    server.hono.get('/crash', () => {
      throw new Error('test crash');
    });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/crash`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      await handle.close();
    }
  });

  it('health endpoint returns ok', async () => {
    const server = new AgentForgeServer({ port: 0 });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    } finally {
      await handle.close();
    }
  });
});
