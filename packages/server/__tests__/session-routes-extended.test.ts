import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionRoutes } from '../src/routes/sessions.js';
import { AgentRegistry } from '../src/registry.js';
import { SessionEventStream } from '../src/session-event-stream.js';
import type { SessionStorage, SessionRecord } from '@primo-ai/sdk';
import { parseSSE } from '../src/sse.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(sessions: SessionRecord[] = []): SessionStorage {
  const store = [...sessions];
  const messagesStore = new Map<string, any[]>();

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
    get: vi.fn().mockImplementation(async (id: string) => {
      return store.find(s => s.sessionId === id);
    }),
    updateMeta: vi.fn().mockImplementation(async (id: string, meta: Partial<SessionRecord>) => {
      const idx = store.findIndex(s => s.sessionId === id);
      if (idx >= 0) {
        Object.assign(store[idx], meta, { updatedAt: new Date().toISOString() });
      }
    }),
    delete: vi.fn().mockImplementation(async (id: string) => {
      const idx = store.findIndex(s => s.sessionId === id);
      if (idx >= 0) {
        store.splice(idx, 1);
      }
    }),
    getMessages: vi.fn().mockImplementation(async (id: string, options?: { limit?: number }) => {
      const msgs = messagesStore.get(id) ?? [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
        { role: 'user', content: 'how are you' },
        { role: 'assistant', content: 'fine' },
      ];
      if (options?.limit && options.limit > 0) {
        return msgs.slice(-options.limit);
      }
      return msgs;
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

function setupApp(
  sessions: SessionRecord[] = [],
  opts?: { registry?: AgentRegistry; eventStream?: SessionEventStream },
) {
  const storage = createMockStorage(sessions);
  const registry = opts?.registry ?? new AgentRegistry();
  const eventStream = opts?.eventStream ?? new SessionEventStream(registry);
  const app = sessionRoutes(storage, registry, eventStream);
  return { storage, registry, eventStream, app };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extended session routes', () => {

  // ---- Fixed existing routes ----

  describe('GET /:id (fixed)', () => {
    it('uses storage.get() instead of listing all sessions', async () => {
      const sessions = [makeSession('s1'), makeSession('s2')];
      const { storage, app } = setupApp(sessions);

      const res = await app.request('/s1');
      expect(res.status).toBe(200);
      const body = await res.json() as SessionRecord;
      expect(body.sessionId).toBe('s1');

      // Verify get was called, not list
      expect(storage.get).toHaveBeenCalledWith('s1');
    });

    it('returns 404 when session not found', async () => {
      const { app } = setupApp([makeSession('s1')]);
      const res = await app.request('/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 404 when storage is not configured', async () => {
      const app = sessionRoutes(undefined, undefined, undefined);
      const res = await app.request('/any');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id (fixed)', () => {
    it('uses storage.delete() directly', async () => {
      const sessions = [makeSession('s1')];
      const { storage, app } = setupApp(sessions);

      const res = await app.request('/s1', { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(storage.delete).toHaveBeenCalledWith('s1');
    });

    it('returns 404 for nonexistent session', async () => {
      const { app } = setupApp([makeSession('s1')]);
      const res = await app.request('/nonexistent', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ---- New routes ----

  describe('GET /status', () => {
    it('returns batch status for active sessions', async () => {
      const sessions = [
        makeSession('s1', { status: 'active' }),
        makeSession('s2', { status: 'completed' }),
      ];
      const { app } = setupApp(sessions);

      const res = await app.request('/status');
      expect(res.status).toBe(200);
      const body = await res.json() as SessionRecord[];
      expect(body).toHaveLength(2);
    });

    it('returns empty array when no storage configured', async () => {
      const app = sessionRoutes(undefined, undefined, undefined);
      const res = await app.request('/status');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('GET /:id/messages', () => {
    it('returns message history', async () => {
      const sessions = [makeSession('s1')];
      const { storage, app } = setupApp(sessions);

      const res = await app.request('/s1/messages');
      expect(res.status).toBe(200);
      const body = await res.json() as any[];
      expect(body.length).toBeGreaterThan(0);
      expect(storage.getMessages).toHaveBeenCalledWith('s1', {});
    });

    it('passes limit query param', async () => {
      const sessions = [makeSession('s1')];
      const { storage, app } = setupApp(sessions);

      const res = await app.request('/s1/messages?limit=2');
      expect(res.status).toBe(200);
      expect(storage.getMessages).toHaveBeenCalledWith('s1', { limit: 2 });
    });

    it('returns 404 for nonexistent session', async () => {
      const { app } = setupApp([]);
      const res = await app.request('/nonexistent/messages');
      expect(res.status).toBe(404);
    });

    it('returns 404 when storage not configured', async () => {
      const app = sessionRoutes(undefined, undefined, undefined);
      const res = await app.request('/any/messages');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/abort', () => {
    it('aborts a running session', async () => {
      const sessions = [makeSession('s1', { status: 'active' })];
      const { registry, storage, app } = setupApp(sessions);

      // Register agent and session mapping
      const agent = registry.register('agent-1', { model: 'm', tools: [] });
      agent.abort = vi.fn();
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/abort', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ aborted: true, sessionId: 's1' });
      expect(agent.abort).toHaveBeenCalled();
      expect(storage.updateMeta).toHaveBeenCalledWith('s1', { status: 'cancelled' });
    });

    it('returns 404 when no agent for session', async () => {
      const sessions = [makeSession('s1')];
      const { app } = setupApp(sessions);

      const res = await app.request('/s1/abort', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when session not found', async () => {
      const { app } = setupApp([]);

      const res = await app.request('/nonexistent/abort', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('returns 404 when registry not configured', async () => {
      const app = sessionRoutes(createMockStorage([makeSession('s1')]), undefined, undefined);
      const res = await app.request('/s1/abort', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/prompt', () => {
    it('sends a message and returns AgentRunResult', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);

      const agent = registry.register('agent-1', { model: 'm', tools: [] });
      const mockResult = {
        response: 'Hello back!',
        tokenUsage: { input: 10, output: 5 },
        sessionId: 's1',
        compatRetries: 0,
      };
      agent.continue = vi.fn().mockResolvedValue(mockResult);
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(mockResult);
      expect(agent.continue).toHaveBeenCalledWith('s1', 'hello');
    });

    it('returns 400 when message is missing', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);
      registry.register('agent-1', { model: 'm', tools: [] });
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when message is not a string', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);
      registry.register('agent-1', { model: 'm', tools: [] });
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 123 }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when no agent for session', async () => {
      const sessions = [makeSession('s1')];
      const { app } = setupApp(sessions);

      const res = await app.request('/s1/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 when session not found', async () => {
      const { app } = setupApp([]);

      const res = await app.request('/nonexistent/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/prompt/stream', () => {
    it('returns text/event-stream response', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);

      const agent = registry.register('agent-1', { model: 'm', tools: [] });
      agent.continueStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'text_delta', text: 'Hello ' };
        yield { type: 'text_delta', text: 'world' };
      });
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/prompt/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
    });

    it('streams SSE events with session.started and session.completed', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);

      const agent = registry.register('agent-1', { model: 'm', tools: [] });
      agent.continueStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'text_delta', text: 'response' };
      });
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/prompt/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      const raw = await res.text();
      const messages = Array.from(parseSSE(raw));
      const types = messages.map(m => m.type);

      expect(types).toContain('session.started');
      expect(types).toContain('text_delta');
      expect(types).toContain('session.completed');
    });

    it('returns 400 when message is missing', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);
      registry.register('agent-1', { model: 'm', tools: [] });
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/prompt/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 when no agent for session', async () => {
      const sessions = [makeSession('s1')];
      const { app } = setupApp(sessions);

      const res = await app.request('/s1/prompt/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /:id/events', () => {
    it('returns text/event-stream response', async () => {
      const sessions = [makeSession('s1')];
      const { registry, app } = setupApp(sessions);
      registry.register('agent-1', { model: 'm', tools: [] });
      registry.registerSession('s1', 'agent-1');

      const res = await app.request('/s1/events');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
    });

    it('returns 404 when session not found', async () => {
      const { app } = setupApp([]);
      const res = await app.request('/nonexistent/events');
      expect(res.status).toBe(404);
    });

    it('returns 404 when no eventStream configured', async () => {
      const app = sessionRoutes(createMockStorage([makeSession('s1')]), new AgentRegistry(), undefined as any);
      const res = await app.request('/s1/events');
      expect(res.status).toBe(404);
    });
  });
});
