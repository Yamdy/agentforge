import { describe, it, expect, vi } from 'vitest';
import { AgentForgeServer } from '../src/server.js';
import { AgentRegistry } from '../src/registry.js';
import { SessionEventStream } from '../src/session-event-stream.js';
import { sessionRoutes } from '../src/routes/sessions.js';
import type { SessionStorage, SessionRecord } from '@primo-ai/sdk';

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
    get: vi.fn().mockImplementation(async (id: string) => store.find(s => s.sessionId === id)),
    updateMeta: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
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

// ---------------------------------------------------------------------------
// Server passes registry + eventStream to sessionRoutes
// ---------------------------------------------------------------------------
describe('Server passes registry and event stream to session routes', () => {
  it('POST /sessions/:id/abort works through AgentForgeServer when registry is configured', async () => {
    const storage = createMockStorage([makeSession('s1')]);

    // NOTE: Before Bug 1 fix, server.ts only passes this._sessionStorage to
    // sessionRoutes(), so registry is undefined in the route handler.
    // This causes POST /:id/abort to return 404 {"error": "Registry not configured"}.
    const server = new AgentForgeServer({ port: 0, sessionStorage: storage });

    const agent = server.registry.register('agent-1', { model: 'm', tools: [] });
    agent.abort = vi.fn();
    server.registry.registerSession('s1', 'agent-1');

    const res = await server.hono.request('/sessions/s1/abort', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { aborted: boolean };
    expect(body.aborted).toBe(true);
    expect(agent.abort).toHaveBeenCalled();
  });

  it('POST /sessions/:id/prompt works through AgentForgeServer when registry is configured', async () => {
    const storage = createMockStorage([makeSession('s1')]);

    const server = new AgentForgeServer({ port: 0, sessionStorage: storage });

    const agent = server.registry.register('agent-1', { model: 'm', tools: [] });
    agent.run = vi.fn().mockResolvedValue({
      response: 'Hello back!',
      tokenUsage: { input: 10, output: 5 },
      sessionId: 's1',
      compatRetries: 0,
    });
    server.registry.registerSession('s1', 'agent-1');

    const res = await server.hono.request('/sessions/s1/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(200);
  });

  it('GET /sessions/:id/events works through AgentForgeServer when registry is configured', async () => {
    const storage = createMockStorage([makeSession('s1')]);

    const server = new AgentForgeServer({ port: 0, sessionStorage: storage });

    const agent = server.registry.register('agent-1', { model: 'm', tools: [] });
    agent.abort = vi.fn();
    server.registry.registerSession('s1', 'agent-1');

    const res = await server.hono.request('/sessions/s1/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
  });
});

// ---------------------------------------------------------------------------
// POST /:id/prompt passes sessionId option to agent.run()
// ---------------------------------------------------------------------------
describe('POST /:id/prompt passes sessionId to agent.run()', () => {
  it('calls agent.run() with sessionId option', async () => {
    const sessions = [makeSession('s1')];
    const storage = createMockStorage(sessions);
    const registry = new AgentRegistry();
    const app = sessionRoutes(storage, registry, new SessionEventStream(registry));

    const agent = registry.register('agent-1', { model: 'm', tools: [] });
    agent.run = vi.fn().mockResolvedValue({
      response: 'Hello',
      tokenUsage: { input: 10, output: 5 },
      sessionId: 's1',
      compatRetries: 0,
    });
    registry.registerSession('s1', 'agent-1');

    const res = await app.request('/s1/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(200);

    // Before Bug 2 fix: agent.run is called with just ('hello')
    // After fix: agent.run should be called with ('hello', { sessionId: 's1' })
    expect(agent.run).toHaveBeenCalledWith('hello', { sessionId: 's1' });
  });
});

// ---------------------------------------------------------------------------
// registry.registerSession() is called from route handlers
// ---------------------------------------------------------------------------
describe('Route handlers call registry.registerSession()', () => {
  it('POST /agents/:id/run calls registerSession when sessionId is provided', async () => {
    const registry = new AgentRegistry();
    const spy = vi.spyOn(registry, 'registerSession');

    const server = new AgentForgeServer({ port: 0, registry });

    const agent = registry.register('agent-1', { model: 'm', tools: [] });
    // We need a mock run to avoid actually invoking the agent pipeline
    const mockResult = {
      response: 'Hello',
      tokenUsage: { input: 5, output: 3 },
      sessionId: 'sess-1',
      compatRetries: 0,
    };
    agent.run = vi.fn().mockResolvedValue(mockResult);

    const res = await server.hono.request('/agents/agent-1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello', sessionId: 'sess-1' }),
    });
    expect(res.status).toBe(200);

    // Before Bug 3 fix: registerSession is never called in agents.ts
    // After fix: registerSession should be called with (sessionId, agentId)
    expect(spy).toHaveBeenCalledWith('sess-1', 'agent-1');
  });

  it('POST /agents/:id/run establishes session-agent mapping via registerSession', async () => {
    const registry = new AgentRegistry();

    const server = new AgentForgeServer({ port: 0, registry });

    const agent = registry.register('agent-1', { model: 'm', tools: [] });
    const mockResult = {
      response: 'Hi',
      tokenUsage: { input: 5, output: 3 },
      sessionId: 'sess-1',
      compatRetries: 0,
    };
    agent.run = vi.fn().mockResolvedValue(mockResult);

    const res = await server.hono.request('/agents/agent-1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello', sessionId: 'sess-1' }),
    });
    expect(res.status).toBe(200);

    // After Bug 3 fix: getAgentBySession should return the agent
    const mappedAgent = registry.getAgentBySession('sess-1');
    expect(mappedAgent).toBe(agent);
  });

  it('POST /agents/:id/stream calls registerSession when sessionId is provided', async () => {
    const registry = new AgentRegistry();
    const spy = vi.spyOn(registry, 'registerSession');

    const server = new AgentForgeServer({ port: 0, registry });

    const agent = registry.register('agent-1', { model: 'm', tools: [] });
    // Mock streamEvents as an async generator
    agent.streamEvents = vi.fn().mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'Hello' };
    });

    const res = await server.hono.request('/agents/agent-1/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello', sessionId: 'sess-1' }),
    });
    expect(res.status).toBe(200);

    // Before Bug 3 fix: registerSession is never called in agents.ts stream handler
    // After fix: registerSession should be called
    expect(spy).toHaveBeenCalledWith('sess-1', 'agent-1');
  });

  it('POST /agents/:id/run does not call registerSession when no sessionId', async () => {
    const registry = new AgentRegistry();
    const spy = vi.spyOn(registry, 'registerSession');

    const server = new AgentForgeServer({ port: 0, registry });

    const agent = registry.register('agent-1', { model: 'm', tools: [] });
    agent.run = vi.fn().mockResolvedValue({
      response: 'Hello',
      tokenUsage: { input: 5, output: 3 },
      sessionId: crypto.randomUUID(),
      compatRetries: 0,
    });

    const res = await server.hono.request('/agents/agent-1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hello' }),
    });
    expect(res.status).toBe(200);

    // When no sessionId is provided, registerSession should not be called
    expect(spy).not.toHaveBeenCalled();
  });
});
