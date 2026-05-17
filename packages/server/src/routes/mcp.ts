import { Hono } from 'hono';
import type { McpManager } from '@primo-ai/plugins';

export function mcpRoutes(mcpManager?: McpManager): Hono {
  const app = new Hono();

  // GET / — list MCP server statuses
  app.get('/', (c) => {
    if (!mcpManager) return c.json([]);
    return c.json(mcpManager.listServers());
  });

  // GET /:name/tools — list tools from a specific server
  app.get('/:name/tools', (c) => {
    if (!mcpManager) return c.json([]);
    const tools = mcpManager.getServerTools(c.req.param('name'));
    return c.json(tools);
  });

  // POST / — add MCP server at runtime
  app.post('/', async (c) => {
    if (!mcpManager) return c.json({ error: 'MCP manager not configured' }, 404);
    const body = await c.req.json();
    // Validate required fields
    if (!body?.name || typeof body.name !== 'string') {
      return c.json({ error: 'Request body must include { name: string, ... }' }, 400);
    }
    await mcpManager.addServer(body);
    const status = mcpManager.listServers().find(s => s.name === body.name);
    return c.json(status, 201);
  });

  // DELETE /:name — remove MCP server
  app.delete('/:name', async (c) => {
    if (!mcpManager) return c.json({ error: 'MCP manager not configured' }, 404);
    await mcpManager.removeServer(c.req.param('name'));
    return c.json({ removed: true });
  });

  // POST /:name/reconnect — reconnect to server
  app.post('/:name/reconnect', async (c) => {
    if (!mcpManager) return c.json({ error: 'MCP manager not configured' }, 404);
    try {
      await mcpManager.reconnect(c.req.param('name'));
      const status = mcpManager.listServers().find(s => s.name === c.req.param('name'));
      return c.json(status);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404);
    }
  });

  return app;
}
