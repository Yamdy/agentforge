import { Hono } from 'hono';
import type { AgentRegistry } from '../../registry.js';

export function agentRoutes(registry: AgentRegistry): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const list = registry.list();
    const agents = list.map((entry) => ({
      name: entry.id,
      description: '',
      model: 'unknown',
      toolCount: 0,
      lastRunAt: null,
    }));
    return c.json({ agents });
  });

  return app;
}

export function studioAgentRoutes(registry: AgentRegistry): Hono {
  const app = new Hono();

  // GET / — list agents with detail
  app.get('/', (c) => {
    const list = registry.list();
    const agents = list.map((entry) => {
      const agent = registry.get(entry.id);
      const config = agent ? (agent as unknown as { config: Record<string, unknown> }).config : {};
      return {
        id: entry.id,
        name: (config as Record<string, unknown>).name as string ?? entry.id,
        model: (config as Record<string, unknown>).model as string ?? 'unknown',
        state: entry.state,
        toolCount: Array.isArray((config as Record<string, unknown>).tools) ? ((config as Record<string, unknown>).tools as unknown[]).length : 0,
        description: (config as Record<string, unknown>).description as string ?? '',
      };
    });
    return c.json({ agents });
  });

  // GET /:id — agent detail
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const agent = registry.get(id);
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const config = (agent as unknown as { config: Record<string, unknown> }).config;
    const state = (agent as unknown as { state: string }).state;

    return c.json({
      id,
      name: (config as Record<string, unknown>).name as string ?? id,
      model: (config as Record<string, unknown>).model as string ?? 'unknown',
      state,
      tools: (config as Record<string, unknown>).tools ?? [],
      description: (config as Record<string, unknown>).description as string ?? '',
    });
  });

  return app;
}
