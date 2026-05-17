import { Hono } from 'hono';
import type { StudioObservability } from '../../studio/observability.js';

export function traceRoutes(observability: StudioObservability): Hono {
  const app = new Hono();

  // GET / — list traces with optional filters
  app.get('/', (c) => {
    const status = c.req.query('status');
    const agent = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const from = c.req.query('from');
    const to = c.req.query('to');

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (agent) filter.agentName = agent;
    if (from) filter.since = new Date(from).getTime();
    if (to) filter.until = new Date(to).getTime();

    let traces = observability.getTraces(filter);
    const total = traces.length;
    traces = traces.slice(offset, offset + limit);

    return c.json({ traces, total });
  });

  // GET /:id — trace detail
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const trace = observability.getTrace(id);
    if (!trace) return c.json({ error: 'Trace not found' }, 404);
    return c.json({ trace });
  });

  return app;
}
