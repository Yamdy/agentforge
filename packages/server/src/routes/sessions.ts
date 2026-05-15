import { Hono } from 'hono';
import type { SessionStorage } from '@agentforge/sdk';

export function sessionRoutes(storage?: SessionStorage): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    if (!storage) return c.json([]);
    const sessions = await storage.list();
    return c.json(sessions);
  });

  app.get('/:id', async (c) => {
    if (!storage) return c.json({ error: 'Session storage not configured' }, 404);
    const sessionId = c.req.param('id');
    const sessions = await storage.list();
    const session = sessions.find(s => s.sessionId === sessionId);
    if (!session) return c.json({ error: 'Session not found' }, 404);
    return c.json(session);
  });

  return app;
}
