import { Hono } from 'hono';
import type { Context } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionStorage } from '@primo-ai/sdk';
import { StudioObservability } from './studio/observability.js';
import { traceRoutes } from './routes/studio/traces.js';
import { sessionRoutes, studioSessionRoutes } from './routes/studio/sessions.js';
import { metricsRoutes } from './routes/studio/metrics.js';
import { studioAgentRoutes } from './routes/studio/agents.js';
import type { AgentRegistry } from './registry.js';

export interface StudioRouteOptions {
  observability: StudioObservability;
  sessionStorage?: SessionStorage;
  registry: AgentRegistry;
}

export function studioRoutes(opts: StudioRouteOptions): Hono {
  const app = new Hono();

  app.route('/traces', traceRoutes(opts.observability));
  app.route('/sessions', opts.sessionStorage
    ? studioSessionRoutes({ storage: opts.sessionStorage, registry: opts.registry })
    : sessionRoutes(opts.sessionStorage));
  app.route('/metrics', metricsRoutes(opts.observability));
  app.route('/agents', studioAgentRoutes(opts.registry));

  return app;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStaticFile(distDir: string) {
  return (c: Context) => {
    let reqPath = c.req.path;

    // Hono sub-app mounted at /studio keeps the full path in c.req.path
    const prefix = '/studio';
    if (reqPath.startsWith(prefix)) {
      reqPath = reqPath.slice(prefix.length) || '/';
    }

    if (reqPath === '/') reqPath = '/index.html';

    const filePath = resolve(distDir, `.${reqPath}`);
    if (!existsSync(filePath) || filePath.indexOf(resolve(distDir)) !== 0) {
      // SPA fallback: serve index.html for non-file routes
      const indexPath = resolve(distDir, 'index.html');
      if (existsSync(indexPath)) {
        return new Response(readFileSync(indexPath), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      return c.text('Not Found', 404);
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';
    return new Response(readFileSync(filePath), {
      headers: { 'Content-Type': contentType },
    });
  };
}

/**
 * Serves the built studio-ui SPA.
 *
 * In development, the dist may not exist yet — returns a lightweight Hono that
 * returns an informative message.
 */
export function studioStaticRoutes(): Hono {
  const app = new Hono();

  const distDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'studio-ui', 'dist',
  );

  if (!existsSync(distDir)) {
    app.get('*', (c) => c.text('Studio UI not built. Run: cd packages/studio-ui && pnpm build'));
    return app;
  }

  const handler = serveStaticFile(distDir);
  app.get('*', handler);

  return app;
}
