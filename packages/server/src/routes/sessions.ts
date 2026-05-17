import { Hono } from 'hono';
import type { SessionStorage, SessionRecord } from '@primo-ai/sdk';

export function sessionRoutes(storage?: SessionStorage): Hono {
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

  // GET /:id — single session lookup
  app.get('/:id', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const sessions = await storage.list();
    const session = sessions.find(s => s.sessionId === sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(session);
  });

  // DELETE /:id — delete a session
  app.delete('/:id', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');

    // Check if the session exists
    const sessions = await storage.list();
    const session = sessions.find(s => s.sessionId === sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);

    // Delete via storage if it supports delete
    if (typeof (storage as any).delete === 'function') {
      await (storage as any).delete(sessionId);
    }

    return new Response(null, { status: 204 });
  });

  return app;
}
