import { Hono } from 'hono';
import type { StudioObservability } from '../../studio/observability.js';

export function metricsRoutes(observability: StudioObservability): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json(observability.getMetricsSnapshot());
  });

  app.get('/kpi', (c) => {
    const period = c.req.query('period') ?? '24h';
    const periodMs = parsePeriod(period);

    const since = periodMs > 0 ? Date.now() - periodMs : undefined;
    const kpi = observability.getKpi({ since });
    return c.json(kpi);
  });

  return app;
}

function parsePeriod(period: string): number {
  switch (period) {
    case '1h': return 60 * 60 * 1000;
    case '6h': return 6 * 60 * 60 * 1000;
    case '24h': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    default: return 0; // all time
  }
}
