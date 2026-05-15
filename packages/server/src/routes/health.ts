import { Hono } from 'hono';

export function healthRoutes(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
  return app;
}
