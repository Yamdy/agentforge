import { Hono } from 'hono';
import type { SessionStorage, SessionStatus } from '@primo-ai/sdk';

export function sessionRoutes(storage?: SessionStorage): Hono {
  const app = new Hono();

  // GET / — list sessions
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
      agentName: r.model ?? 'unknown',
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
        agentName: record.model ?? 'unknown',
        status: record.status,
        meta: { createdAt: record.createdAt, updatedAt: record.updatedAt },
        events,
      },
    });
  });

  // GET /:id/events — session events with optional filtering
  app.get('/:id/events', async (c) => {
    if (!storage) return c.json({ events: [] });
    const id = c.req.param('id');
    const fromSeq = parseInt(c.req.query('fromSeq') ?? '0', 10);
    const toSeqParam = c.req.query('toSeq');
    const toSeq = toSeqParam ? parseInt(toSeqParam, 10) : undefined;
    const typesParam = c.req.query('types');
    const types = typesParam ? typesParam.split(',') : undefined;

    const events: unknown[] = [];
    for await (const ev of storage.read(id)) {
      if (ev.seq < fromSeq) continue;
      if (toSeq !== undefined && ev.seq > toSeq) continue;
      if (types && !types.includes(ev.type)) continue;
      events.push(ev);
    }

    return c.json({ events });
  });

  return app;
}
