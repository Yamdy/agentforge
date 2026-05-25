import { Hono } from 'hono';
import type { SessionStorage, SessionRecord, SessionStatus } from '@primo-ai/sdk';
import type { AgentRegistry } from '../../registry.js';
import { SessionEventStream } from '../../session-event-stream.js';

// Legacy: minimal read-only session routes (used when sessionStorage is not configured)
export function sessionRoutes(storage?: SessionStorage): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    if (!storage) return c.json({ sessions: [], total: 0 });
    const status = c.req.query('status') as SessionStatus | undefined;
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const records = await storage.list(status ? { status } : {});
    const total = records.length;
    const paged = records.slice(offset, offset + limit);

    const sessions = paged.map((r) => ({
      id: r.sessionId,
      agentName: (r as unknown as Record<string, unknown>).model as string ?? 'unknown',
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      messageCount: 0,
      parentSessionId: r.parentSessionId,
    }));

    return c.json({ sessions, total });
  });

  app.get('/:id', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const id = c.req.param('id');
    const record = await storage.get(id);
    if (!record) return c.json({ error: 'Session not found' }, 404);

    const events: unknown[] = [];
    for await (const ev of storage.read(id)) {
      events.push(ev);
    }

    return c.json({
      session: {
        id: record.sessionId,
        agentName: (record as unknown as Record<string, unknown>).model as string ?? 'unknown',
        status: record.status,
        meta: { createdAt: record.createdAt, updatedAt: record.updatedAt },
        events,
      },
    });
  });

  return app;
}

export interface StudioSessionRouteOptions {
  storage: SessionStorage;
  registry: AgentRegistry;
}

export function studioSessionRoutes(opts: StudioSessionRouteOptions): Hono {
  const app = new Hono();
  const { storage, registry } = opts;
  const eventStream = new SessionEventStream(registry);

  // GET / — list sessions
  app.get('/', async (c) => {
    const status = c.req.query('status') as SessionRecord['status'] | undefined;
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    let records = await storage.list(status ? { status } : undefined);
    const total = records.length;
    records = records.slice(offset, offset + limit);

    const sessions = records.map((r) => ({
      id: r.sessionId,
      agentName: (r as unknown as Record<string, unknown>).model as string ?? 'unknown',
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      messageCount: 0,
      parentSessionId: r.parentSessionId,
    }));

    return c.json({ sessions, total });
  });

  // GET /:id — session detail
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const record = await storage.get(id);
    if (!record) return c.json({ error: 'Session not found' }, 404);

    const events: unknown[] = [];
    for await (const ev of storage.read(id)) {
      events.push(ev);
    }

    return c.json({
      session: {
        id: record.sessionId,
        agentName: (record as unknown as Record<string, unknown>).model as string ?? 'unknown',
        status: record.status,
        meta: { createdAt: record.createdAt, updatedAt: record.updatedAt },
        events,
      },
    });
  });

  // POST /:id/chat — send message (SSE streaming)
  app.post('/:id/chat', async (c) => {
    const sessionId = c.req.param('id');
    const record = await storage.get(sessionId);
    if (!record) return c.json({ error: 'Session not found' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON in request body' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400);
    }
    const obj = body as Record<string, unknown>;
    if (!('message' in obj) || typeof obj.message !== 'string') {
      return c.json({ error: 'Missing or invalid field: message (must be a string)' }, 400);
    }

    const agent = registry.getAgentBySession(sessionId);
    if (!agent) {
      return c.json({ error: 'No agent found for session' }, 404);
    }

    const stream = eventStream.fromAgentStream(sessionId, obj.message);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  // POST /:id/abort — abort a running session
  app.post('/:id/abort', async (c) => {
    const sessionId = c.req.param('id');
    const record = await storage.get(sessionId);
    if (!record) return c.json({ error: 'Session not found' }, 404);

    const agent = registry.getAgentBySession(sessionId);
    if (agent) {
      agent.abort();
      await storage.updateMeta(sessionId, { status: 'cancelled' });
    }

    return c.json({ aborted: true, sessionId });
  });

  // GET /:id/events — SSE subscription for session events
  app.get('/:id/events', async (c) => {
    const sessionId = c.req.param('id');
    const record = await storage.get(sessionId);
    if (!record) return c.json({ error: 'Session not found' }, 404);

    const stream = eventStream.subscribe(sessionId);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  return app;
}
