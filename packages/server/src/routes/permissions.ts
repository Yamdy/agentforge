import { Hono } from 'hono';
import type { PermissionManager } from '@primo-ai/core';

export function permissionRoutes(permissionManager?: PermissionManager): Hono {
  const app = new Hono();

  // GET /pending — list all pending permission requests
  app.get('/pending', (c) => {
    if (!permissionManager) return c.json([]);
    return c.json(permissionManager.list());
  });

  // GET /pending/:permissionId — get single permission detail
  app.get('/pending/:permissionId', (c) => {
    if (!permissionManager) return c.json({ error: 'Permission not found' }, 404);
    const permission = permissionManager.get(c.req.param('permissionId'));
    if (!permission) return c.json({ error: 'Permission not found' }, 404);
    return c.json(permission);
  });

  // POST /pending/:permissionId/respond — approve or deny
  app.post('/pending/:permissionId/respond', async (c) => {
    if (!permissionManager) return c.json({ error: 'Permission manager not configured' }, 404);
    const body = await c.req.json();
    if (!body || typeof body.approved !== 'boolean') {
      return c.json({ error: 'Request body must include { approved: boolean }' }, 400);
    }
    try {
      permissionManager.resolve(c.req.param('permissionId'), body.approved);
      return c.json({ resolved: true, permissionId: c.req.param('permissionId'), decision: body.approved ? 'allow' : 'deny' });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 404);
    }
  });

  return app;
}
