import { Hono } from 'hono';
import type { SessionStorage, SessionRecord } from '@primo-ai/sdk';
import type { AgentRegistry } from '../registry.js';
import type { SessionEventStream } from '../session-event-stream.js';

export function sessionRoutes(
  storage?: SessionStorage,
  registry?: AgentRegistry,
  eventStream?: SessionEventStream,
): Hono {
  const app = new Hono();

  // GET / — list sessions with optional query params
  app.get('/', async (c) => {
    if (!storage) return c.json([]);

    const status = c.req.query('status') as SessionRecord['status'] | undefined;
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');

    let sessions = await storage.list(status ? { status } : undefined);

    // Apply offset
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    if (offsetNum > 0) {
      sessions = sessions.slice(offsetNum);
    }

    // Apply limit
    const limitNum = limit ? parseInt(limit, 10) : sessions.length;
    if (limitNum > 0) {
      sessions = sessions.slice(0, limitNum);
    }

    return c.json(sessions);
  });

  // GET /status — batch status for active sessions
  app.get('/status', async (c) => {
    if (!storage) return c.json([]);
    const sessions = await storage.list();
    return c.json(sessions);
  });

  // GET /:id — single session lookup (fixed: uses storage.get)
  app.get('/:id', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(session);
  });

  // GET /:id/messages — get message history with pagination
  app.get('/:id/messages', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const limitStr = c.req.query('limit');
    const options: { limit?: number } = {};
    if (limitStr) {
      const limit = parseInt(limitStr, 10);
      if (limit > 0) options.limit = limit;
    }

    const messages = await storage.getMessages(sessionId, options);
    return c.json(messages);
  });

  // GET /:id/events — SSE subscription for session events
  app.get('/:id/events', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    if (!eventStream) return c.json({ error: 'Event streaming not configured' }, 404);

    const stream = eventStream.subscribe(sessionId);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  // POST /:id/abort — abort a running session
  app.post('/:id/abort', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    if (!registry) return c.json({ error: 'Registry not configured' }, 404);
    const agent = registry.getAgentBySession(sessionId);
    if (!agent) return c.json({ error: 'No agent found for session' }, 404);

    agent.abort();
    await storage.updateMeta(sessionId, { status: 'cancelled' });
    return c.json({ aborted: true, sessionId });
  });

  // POST /:id/prompt — send message (sync, returns AgentRunResult)
  app.post('/:id/prompt', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    if (!registry) return c.json({ error: 'Registry not configured' }, 404);
    const agent = registry.getAgentBySession(sessionId);
    if (!agent) return c.json({ error: 'No agent found for session' }, 404);

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

    const result = await agent.run(obj.message);
    return c.json(result);
  });

  // POST /:id/prompt/stream — send message (SSE streaming)
  app.post('/:id/prompt/stream', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    if (!registry) return c.json({ error: 'Registry not configured' }, 404);
    const agent = registry.getAgentBySession(sessionId);
    if (!agent) return c.json({ error: 'No agent found for session' }, 404);

    if (!eventStream) return c.json({ error: 'Event streaming not configured' }, 404);

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

    const stream = eventStream.fromAgentStream(sessionId, obj.message);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  // DELETE /:id — delete a session (fixed: uses storage.delete directly)
  app.delete('/:id', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');

    // Check if the session exists
    const session = await storage.get(sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    await storage.delete(sessionId);
    return new Response(null, { status: 204 });
  });

  return app;
}
