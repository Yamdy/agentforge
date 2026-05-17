import { describe, it, expect } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import { FilesystemSessionStorage } from '@primo-ai/core';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeServer() {
  const storageDir = mkdtempSync(join(tmpdir(), 'af-test-'));
  const storage = new FilesystemSessionStorage(storageDir);
  return { server: new AgentForgeServer({ port: 0, sessionStorage: storage }), storage };
}

describe('Sessions route', () => {
  it('returns 404 for unknown session', async () => {
    const { server } = makeServer();
    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/nonexistent`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      await handle.close();
    }
  });

  it('returns session that was created via storage', async () => {
    const { server, storage } = makeServer();
    const sessionId = crypto.randomUUID();
    await storage.updateMeta(sessionId, { sessionId, status: 'active' });

    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/${sessionId}`);
      expect(res.status).toBe(200);
      const session = await res.json() as { sessionId: string; status: string };
      expect(session.sessionId).toBe(sessionId);
      expect(session.status).toBe('active');
    } finally {
      await handle.close();
    }
  });

  it('lists sessions from storage', async () => {
    const { server, storage } = makeServer();
    await storage.updateMeta('s1', { sessionId: 's1', status: 'active' });
    await storage.updateMeta('s2', { sessionId: 's2', status: 'completed' });

    const handle = await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/sessions`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ sessionId: string }>;
      expect(body.length).toBeGreaterThanOrEqual(2);
      const ids = body.map(s => s.sessionId);
      expect(ids).toContain('s1');
      expect(ids).toContain('s2');
    } finally {
      await handle.close();
    }
  });
});
