import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { AgentRegistry } from '../src/registry.js';
import type { SessionStorage, SessionRecord } from '@primo-ai/sdk';
import { studioSessionRoutes } from '../src/routes/studio/sessions.js';

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
      if (filter?.status) result = result.filter(s => s.status === filter.status);
      if (filter?.parentSessionId) result = result.filter(s => s.parentSessionId === filter.parentSessionId);
      return result;
    }),
    updateMeta: vi.fn().mockImplementation(async (id: string, meta: Partial<SessionRecord>) => {
      const idx = store.findIndex(s => s.sessionId === id);
      if (idx >= 0) Object.assign(store[idx], meta, { updatedAt: new Date().toISOString() });
      else store.push({ sessionId: id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'active', ...meta });
    }),
    delete: vi.fn().mockImplementation(async (id: string) => {
      const idx = store.findIndex(s => s.sessionId === id);
      if (idx >= 0) { store.splice(idx, 1); return true; }
      return false;
    }),
    get: vi.fn().mockImplementation(async (id: string) => store.find(s => s.sessionId === id)),
    getMessages: vi.fn().mockResolvedValue([]),
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

function createMockRegistry(): AgentRegistry {
  const registry = new AgentRegistry();
  const config = { name: 'test-agent', model: 'gpt-4', tools: [{ name: 'echo', description: 'echo tool', parameters: {} }] };
  registry.register('test-agent', config as any);
  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Studio Session routes', () => {
  let app: Hono;
  let storage: SessionStorage;
  let registry: AgentRegistry;

  beforeEach(() => {
    storage = createMockStorage();
    registry = createMockRegistry();
    app = new Hono();
    app.route('/api/studio/sessions', studioSessionRoutes({ storage, registry }));
  });

  describe('GET /', () => {
    it('returns sessions as { sessions, total }', async () => {
      const sessions = [makeSession('s1'), makeSession('s2')];
      storage = createMockStorage(sessions);
      app = new Hono();
      app.route('/api/studio/sessions', studioSessionRoutes({ storage, registry }));

      const res = await app.request('/api/studio/sessions');
      expect(res.status).toBe(200);
      const body = await res.json() as { sessions: SessionRecord[]; total: number };
      expect(body.sessions).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('returns empty list with total 0 when no sessions', async () => {
      const res = await app.request('/api/studio/sessions');
      expect(res.status).toBe(200);
      const body = await res.json() as { sessions: SessionRecord[]; total: number };
      expect(body.sessions).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  describe('GET /:id', () => {
    it('returns session detail', async () => {
      const sessions = [makeSession('s1', { status: 'active' })];
      storage = createMockStorage(sessions);
      app = new Hono();
      app.route('/api/studio/sessions', studioSessionRoutes({ storage, registry }));

      const res = await app.request('/api/studio/sessions/s1');
      expect(res.status).toBe(200);
      const body = await res.json() as { session: { id: string } };
      expect(body.session.id).toBe('s1');
    });

    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/api/studio/sessions/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/chat', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/api/studio/sessions/nonexistent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 when message field is missing', async () => {
      const sessions = [makeSession('s1')];
      storage = createMockStorage(sessions);
      app = new Hono();
      app.route('/api/studio/sessions', studioSessionRoutes({ storage, registry }));

      const res = await app.request('/api/studio/sessions/s1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns SSE stream for a valid chat request', async () => {
      const sessions = [makeSession('s1')];
      storage = createMockStorage(sessions);
      // Register session→agent mapping so chat can find the agent
      registry.registerSession('s1', 'test-agent');
      app = new Hono();
      app.route('/api/studio/sessions', studioSessionRoutes({ storage, registry }));

      const res = await app.request('/api/studio/sessions/s1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    });
  });

  describe('POST /:id/abort', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/api/studio/sessions/nonexistent/abort', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:id/events', () => {
    it('returns 404 for non-existent session', async () => {
      const res = await app.request('/api/studio/sessions/nonexistent/events');
      expect(res.status).toBe(404);
    });

    it('returns SSE stream for existing session', async () => {
      const sessions = [makeSession('s1')];
      storage = createMockStorage(sessions);
      app = new Hono();
      app.route('/api/studio/sessions', studioSessionRoutes({ storage, registry }));

      const res = await app.request('/api/studio/sessions/s1/events');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    });
  });
});
