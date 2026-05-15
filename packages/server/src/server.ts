import { Hono } from 'hono';
import { AgentRegistry } from './registry.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { sessionRoutes } from './routes/sessions.js';
import { authMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/logger.js';
import type { SessionStorage, AuthAdapter } from '@agentforge/sdk';
import { StaticKeyAuthAdapter } from './middleware/static-key-auth.js';

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface ServerOptions {
  port?: number;
  apiKey?: string;
  authAdapter?: AuthAdapter;
  sessionStorage?: SessionStorage;
}

export class AgentForgeServer {
  readonly registry = new AgentRegistry();
  private app: Hono;
  private port: number;
  private serverHandle: ReturnType<typeof import('@hono/node-server').serve> | null = null;
  private _sessionStorage?: SessionStorage;

  constructor(options?: ServerOptions) {
    this.port = options?.port ?? 3000;
    this._sessionStorage = options?.sessionStorage;
    this.app = new Hono();

    const resolvedAdapter = options?.authAdapter
      ?? (options?.apiKey ? new StaticKeyAuthAdapter(options.apiKey) : undefined);

    if (resolvedAdapter) {
      this.app.use('*', authMiddleware(resolvedAdapter));
    }

    this.app.use('*', requestLogger);

    this.app.onError((err, _c) => {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    this.app.route('/health', healthRoutes());
    this.app.route('/agents', agentRoutes(this.registry));
    this.app.route('/sessions', sessionRoutes(this._sessionStorage));
  }

  get hono(): Hono {
    return this.app;
  }

  async start(): Promise<ServerHandle> {
    const { serve } = await import('@hono/node-server');
    return new Promise((resolve) => {
      const server = serve({ fetch: this.app.fetch, port: this.port }, (info) => {
        this.serverHandle = server;
        resolve({ port: info.port, close: () => this.stop() });
      });
    });
  }

  async stop(): Promise<void> {
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
    }
  }
}
