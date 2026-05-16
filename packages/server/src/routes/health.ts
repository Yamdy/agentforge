import { Hono } from 'hono';
import type { AgentRegistry } from '../registry.js';

export interface HealthRouteDeps {
  registry?: AgentRegistry;
  getStartTime: () => Date | undefined;
  version?: string;
}

export function healthRoutes(deps?: HealthRouteDeps | AgentRegistry): Hono {
  // Support both old AgentRegistry param and new deps object
  const resolvedDeps: HealthRouteDeps = deps && 'getStartTime' in deps
    ? deps as HealthRouteDeps
    : { registry: deps as AgentRegistry | undefined, getStartTime: () => undefined };

  const app = new Hono();

  // GET /health — basic health check
  app.get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // GET /health/live — liveness probe
  app.get('/live', (c) => c.json({ status: 'ok' }));

  // GET /health/ready — readiness probe with metadata
  app.get('/ready', (c) => {
    const startTime = resolvedDeps.getStartTime();
    const uptime = startTime ? Date.now() - startTime.getTime() : 0;
    const agents = resolvedDeps.registry?.list().length ?? 0;

    return c.json({
      status: 'ok',
      version: resolvedDeps.version ?? '0.0.1',
      uptime,
      agents,
    });
  });

  return app;
}
