import { contextStorage } from 'hono/context-storage';
import { createLogger } from '../../logger/index.js';

const log = createLogger('auth');

export interface AuthConfig {
  apiKey?: string;
}

export function authMiddleware(config: AuthConfig) {
  return async (c: any, next: () => Promise<void>) => {
    if (!config.apiKey) {
      return next();
    }

    const authHeader = c.req.header('Authorization');
    const apiKeyHeader = c.req.header('X-API-Key');

    const token = authHeader?.replace(/^Bearer\s+/, '') || apiKeyHeader;

    if (!token || token !== config.apiKey) {
      log.warn('Unauthorized request', { path: c.req.path });
      return c.json({ error: 'Unauthorized', message: 'Invalid or missing API key' }, 401);
    }

    await next();
  };
}
