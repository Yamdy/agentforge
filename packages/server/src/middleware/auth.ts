import type { MiddlewareHandler } from 'hono';
import type { AuthAdapter } from '@agentforge/sdk';

export function authMiddleware(adapter: AuthAdapter): MiddlewareHandler {
  return async (c, next) => {
    const result = await adapter.authenticate({ header: (name) => c.req.header(name) });
    if (!result.authenticated) {
      return c.json({ error: result.error ?? 'Unauthorized' }, 401);
    }
    await next();
  };
}
