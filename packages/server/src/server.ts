import { Hono } from 'hono';
import { cors as honoCors } from 'hono/cors';
import { AgentRegistry } from './registry.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { sessionRoutes } from './routes/sessions.js';
import { permissionRoutes } from './routes/permissions.js';
import { providerRoutes } from './routes/providers.js';
import { mcpRoutes } from './routes/mcp.js';
import { authMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/logger.js';
import { WebSocketBridge } from './bridge/bridge.js';
import { a2aRoutes, type A2ARoutesOptions } from './a2a/routes.js';
import type { SessionStorage, AuthAdapter } from '@primo-ai/sdk';
import type { PermissionManager, ModelFactory } from '@primo-ai/core';
import type { McpManager } from '@primo-ai/plugins';
import { StaticKeyAuthAdapter } from './middleware/static-key-auth.js';

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface CorsOptions {
  origin: string;
  methods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface A2AOptions {
  agentId: string;
  cardOptions: Omit<A2ARoutesOptions['cardOptions'], 'tools'>;
}

export interface ServerOptions {
  port?: number;
  apiKey?: string;
  authAdapter?: AuthAdapter;
  sessionStorage?: SessionStorage;
  registry?: AgentRegistry;
  enableWebSocket?: boolean;
  cors?: CorsOptions;
  a2a?: A2AOptions;
  requestTimeout?: number;
  shutdownTimeout?: number;
  modelFactory?: ModelFactory;
  permissionManager?: PermissionManager;
  mcpManager?: McpManager;
}

const DEFAULT_REQUEST_TIMEOUT = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;

/** Minimal shape of a WebSocket instance (avoids hard dep on @types/ws). */
interface WsLike {
  send(data: unknown): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export class AgentForgeServer {
  readonly registry: AgentRegistry;
  readonly bridge: WebSocketBridge;
  private app: Hono;
  private port: number;
  private serverHandle: ReturnType<typeof import('@hono/node-server').serve> | null = null;
  private _sessionStorage?: SessionStorage;
  private _enableWebSocket: boolean;
  private _shutdownTimeout: number;
  private _requestTimeout: number;
  private _startTime?: Date;
  private _modelFactory?: ModelFactory;
  private _permissionManager?: PermissionManager;
  private _mcpManager?: McpManager;

  constructor(options?: ServerOptions) {
    this.registry = options?.registry ?? new AgentRegistry();
    this.port = options?.port ?? 3000;
    this._sessionStorage = options?.sessionStorage;
    this._enableWebSocket = options?.enableWebSocket ?? false;
    this._shutdownTimeout = options?.shutdownTimeout ?? DEFAULT_SHUTDOWN_TIMEOUT;
    this._requestTimeout = options?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    this._modelFactory = options?.modelFactory;
    this._permissionManager = options?.permissionManager;
    this._mcpManager = options?.mcpManager;
    this.app = new Hono();
    this.bridge = new WebSocketBridge(this.registry);

    const resolvedAdapter = options?.authAdapter
      ?? (options?.apiKey ? new StaticKeyAuthAdapter(options.apiKey) : undefined);

    if (resolvedAdapter) {
      this.app.use('*', authMiddleware(resolvedAdapter));
    }

    // CORS middleware
    if (options?.cors) {
      const corsOpts = options.cors;
      this.app.use('*', honoCors({
        origin: corsOpts.origin,
        allowMethods: corsOpts.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: corsOpts.allowHeaders ?? [],
        exposeHeaders: corsOpts.exposeHeaders ?? [],
        credentials: corsOpts.credentials ?? false,
        maxAge: corsOpts.maxAge,
      }));
    }

    this.app.use('*', requestLogger);

    this.app.onError((err, _c) => {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    this.app.route('/health', healthRoutes({
      registry: this.registry,
      getStartTime: () => this._startTime,
      version: '0.0.1',
    }));
    this.app.route('/agents', agentRoutes(this.registry));
    this.app.route('/sessions', sessionRoutes(this._sessionStorage));
    this.app.route('/permissions', permissionRoutes(this._permissionManager));
    this.app.route('/providers', providerRoutes(this._modelFactory));
    this.app.route('/mcp', mcpRoutes(this._mcpManager));

    // Mount A2A routes if configured
    if (options?.a2a) {
      const { app: a2aApp } = a2aRoutes({
        registry: this.registry,
        agentId: options.a2a.agentId,
        cardOptions: options.a2a.cardOptions,
      });
      this.app.route('/a2a', a2aApp);
    }
  }

  get hono(): Hono {
    return this.app;
  }

  /** Server start time — used for uptime calculation in health checks. */
  get startTime(): Date | undefined {
    return this._startTime;
  }

  /**
   * Create an HTTP upgrade handler for WebSocket connections.
   * Intended to be used with Node.js HTTP server's 'upgrade' event.
   *
   * @example
   * ```ts
   * const server = http.createServer();
   * server.on('upgrade', agentForgeServer.createUpgradeHandler());
   * ```
   */
  createUpgradeHandler() {
    return (req: { headers: { get(name: string): string | null } }, socket: { destroy(): void }, _head: Buffer) => {
      const upgradeHeader = req.headers.get?.('upgrade') ?? (req.headers as unknown as Record<string, string | undefined>)['upgrade'];
      if (upgradeHeader?.toLowerCase() !== 'websocket') {
        socket.destroy();
        return;
      }

      // Lazy-load 'ws' to avoid hard dependency
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const wsModule = require('ws');
        const wss = new (wsModule as any).WebSocketServer({ noServer: true }) as any;
        wss.handleUpgrade(
          req as any,
          socket as any,
          _head,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (ws: any) => {
            this.bridge.handleUpgrade({
              send: (data: string) => ws.send(data),
              close: () => ws.close(),
              on: (event: string, handler: (...args: unknown[]) => void) => {
                ws.on(event as any, handler as any);
              },
            });
          },
        );
      } catch {
        // 'ws' module not installed — destroy the socket
        socket.destroy();
      }
    };
  }

  async start(): Promise<ServerHandle> {
    this._startTime = new Date();
    const { serve } = await import('@hono/node-server');
    return new Promise((resolve) => {
      const server = serve({ fetch: this.app.fetch, port: this.port }, (info) => {
        this.serverHandle = server;
        resolve({ port: info.port, close: () => this.stop() });
      });
      // Set request timeout at the HTTP server level
      const httpServer = server as import('node:http').Server;
      httpServer.requestTimeout = this._requestTimeout;
      httpServer.headersTimeout = this._requestTimeout + 1000;
      // Wire WebSocket upgrade handler if enabled
      if (this._enableWebSocket) {
        const handler = this.createUpgradeHandler();
        server.on('upgrade', handler as any);
      }
    });
  }

  async stop(): Promise<void> {
    this.bridge.closeAll();
    if (this.serverHandle) {
      const server = this.serverHandle;
      this.serverHandle = null;

      // Graceful shutdown: wait for in-flight connections with timeout
      await new Promise<void>((resolve) => {
        const httpServer = server as import('node:http').Server;
        const forceTimeout = setTimeout(() => {
          httpServer.closeAllConnections?.();
          resolve();
        }, this._shutdownTimeout);

        server.close(() => {
          clearTimeout(forceTimeout);
          resolve();
        });
      });
    }
  }
}
