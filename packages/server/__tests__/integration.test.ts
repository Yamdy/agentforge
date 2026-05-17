import { describe, it, expect } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import { FilesystemSessionStorage } from '@primo-ai/core';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeServer(opts?: { apiKey?: string }) {
  const storageDir = mkdtempSync(join(tmpdir(), 'af-int-'));
  const storage = new FilesystemSessionStorage(storageDir);
  return new AgentForgeServer({ port: 0, apiKey: opts?.apiKey, sessionStorage: storage });
}

describe('Integration: full HTTP lifecycle', () => {
  it('health check works without auth', async () => {
    const server = makeServer();
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    } finally {
      await handle.close();
    }
  });

  it('blocks unauthenticated requests when apiKey is set', async () => {
    const server = makeServer({ apiKey: 'secret' });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(401);
    } finally {
      await handle.close();
    }
  });

  it('allows authenticated requests with valid apiKey', async () => {
    const server = makeServer({ apiKey: 'secret' });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`, {
        headers: { Authorization: 'Bearer secret' },
      });
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('lists registered agents', async () => {
    const server = makeServer();
    server.registry.register('my-agent', { model: 'test/model' });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/agents`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ id: string; state: string }>;
      expect(body.some(a => a.id === 'my-agent')).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('returns 404 for unknown agent', async () => {
    const server = makeServer();
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/agents/nonexistent`);
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('returns 404 for unknown session', async () => {
    const server = makeServer();
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/nonexistent`);
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('returns JSON for unhandled errors', async () => {
    const server = makeServer();
    server.hono.get('/_test_crash', () => {
      throw new Error('boom');
    });
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/_test_crash`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('boom');
    } finally {
      await handle.close();
    }
  });

  it('graceful shutdown closes the server', async () => {
    const server = makeServer();
    const handle = await server.start();
    const port = handle.port;
    await handle.close();
    const res = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
    expect(res).toBeNull();
  });
});
