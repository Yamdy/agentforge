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
