import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import type { SessionStorage, SessionRecord } from '@agentforge/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(sessions: SessionRecord[] = []): SessionStorage {
  const store = [...sessions];
  return {
    append: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockImplementation(async function* () {
      for (const s of store) {
        yield { seq: 0, timestamp: s.createdAt, type: 'meta', payload: s };
      }
    }),
    list: vi.fn().mockImplementation(async (filter?: { parentSessionId?: string; status?: string }) => {
      let result = [...store];
      if (filter?.status) {
        result = result.filter(s => s.status === filter.status);
      }
      if (filter?.parentSessionId) {
        result = result.filter(s => s.parentSessionId === filter.parentSessionId);
      }
      return result;
    }),
    updateMeta: vi.fn().mockImplementation(async (id: string, meta: Partial<SessionRecord>) => {
      const idx = store.findIndex(s => s.sessionId === id);
      if (idx >= 0) {
        Object.assign(store[idx], meta, { updatedAt: new Date().toISOString() });
      } else {
        store.push({
          sessionId: id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'active',
          ...meta,
        });
      }
    }),
    // Extra method for delete support
    delete: vi.fn().mockImplementation(async (id: string) => {
      const idx = store.findIndex(s => s.sessionId === id);
      if (idx >= 0) {
        store.splice(idx, 1);
        return true;
      }
      return false;
    }),
  } as unknown as SessionStorage;
}

function makeSession(id: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    sessionId: id,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Session routes', () => {
  describe('GET /sessions', () => {
    it('returns empty list when no sessions', async () => {
      const storage = createMockStorage();
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual([]);
      } finally {
        await handle.close();
      }
    });

    it('returns all sessions', async () => {
      const sessions = [
        makeSession('s1', { status: 'active' }),
        makeSession('s2', { status: 'completed' }),
      ];
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions`);
        expect(res.status).toBe(200);
        const body = await res.json() as SessionRecord[];
        expect(body).toHaveLength(2);
        const ids = body.map(s => s.sessionId);
        expect(ids).toContain('s1');
        expect(ids).toContain('s2');
      } finally {
        await handle.close();
      }
    });

    it('filters by status query param', async () => {
      const sessions = [
        makeSession('s1', { status: 'active' }),
        makeSession('s2', { status: 'completed' }),
        makeSession('s3', { status: 'active' }),
      ];
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions?status=active`);
        expect(res.status).toBe(200);
        const body = await res.json() as SessionRecord[];
        expect(body).toHaveLength(2);
        expect(body.every(s => s.status === 'active')).toBe(true);
      } finally {
        await handle.close();
      }
    });

    it('applies limit query param', async () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        makeSession(`s${i}`, { status: 'active' })
      );
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions?limit=3`);
        expect(res.status).toBe(200);
        const body = await res.json() as SessionRecord[];
        expect(body).toHaveLength(3);
      } finally {
        await handle.close();
      }
    });

    it('applies offset query param', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        makeSession(`s${i}`, { status: 'active' })
      );
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions?offset=2`);
        expect(res.status).toBe(200);
        const body = await res.json() as SessionRecord[];
        // Should skip first 2, return remaining 3
        expect(body).toHaveLength(3);
      } finally {
        await handle.close();
      }
    });

    it('applies limit and offset together', async () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        makeSession(`s${i}`, { status: 'active' })
      );
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions?offset=5&limit=2`);
        expect(res.status).toBe(200);
        const body = await res.json() as SessionRecord[];
        expect(body).toHaveLength(2);
      } finally {
        await handle.close();
      }
    });

    it('returns empty list when storage is not configured', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual([]);
      } finally {
        await handle.close();
      }
    });
  });

  describe('GET /sessions/:id', () => {
    it('returns a specific session', async () => {
      const sessions = [
        makeSession('s1', { status: 'active' }),
        makeSession('s2', { status: 'completed' }),
      ];
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/s1`);
        expect(res.status).toBe(200);
        const body = await res.json() as SessionRecord;
        expect(body.sessionId).toBe('s1');
      } finally {
        await handle.close();
      }
    });

    it('returns 404 for non-existent session', async () => {
      const storage = createMockStorage([makeSession('s1')]);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
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

    it('returns 404 when storage is not configured', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/any`);
        expect(res.status).toBe(404);
      } finally {
        await handle.close();
      }
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('deletes a session and returns 204', async () => {
      const sessions = [makeSession('s1'), makeSession('s2')];
      const storage = createMockStorage(sessions);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/s1`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(204);

        // Verify session is gone
        const listRes = await fetch(`http://127.0.0.1:${handle.port}/sessions`);
        const body = await listRes.json() as SessionRecord[];
        expect(body).toHaveLength(1);
        expect(body[0].sessionId).toBe('s2');
      } finally {
        await handle.close();
      }
    });

    it('returns 404 when deleting non-existent session', async () => {
      const storage = createMockStorage([makeSession('s1')]);
      const server = new AgentForgeServer({ port: 0, sessionStorage: storage });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/nonexistent`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(404);
      } finally {
        await handle.close();
      }
    });

    it('returns 404 when storage is not configured', async () => {
      const server = new AgentForgeServer({ port: 0 });
      const handle = await server.start();
      try {
        const res = await fetch(`http://127.0.0.1:${handle.port}/sessions/any`, {
          method: 'DELETE',
        });
        expect(res.status).toBe(404);
      } finally {
        await handle.close();
      }
    });
  });
});
