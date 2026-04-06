import type { Context, Next } from 'hono';
import { createLogger } from '../../logger/index.js';

const log = createLogger('request');

export async function loggingMiddleware(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const duration = Date.now() - start;
  log.info('Request', { method, path, status: c.res.status, duration });
}
