import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { Router } from './router.js';
import { InMemorySessionStore } from './session-store.js';
import { FileConfigStore } from './config-store.js';
import { AgentFactory } from './agent-factory.js';
import type { AgentForgeServer, RequestContext } from './types.js';
import {
  createSession,
  listSessions,
  getSession,
  deleteSession,
  clearSession,
  chatStream,
  hitlAnswer,
  cancelSession,
} from './handlers/sessions.js';
import {
  listAgents,
  getAgent,
  saveAgent,
  deleteAgent,
} from './handlers/agents.js';
import { getConfig } from './handlers/config.js';
import { healthCheck, readinessCheck, metrics } from './handlers/health.js';

export interface ServerOptions {
  port?: number;
  configDir: string;
  version?: string;
  /** Path to playground.html. Defaults to auto-detecting from package structure. */
  playgroundPath?: string;
}

/**
 * Create an AgentForge HTTP/SSE server.
 *
 * Sets up all route handlers and returns a Node.js http.Server.
 * Call `start()` to begin listening.
 */
export function createAgentForgeServer(options: ServerOptions): {
  server: Server;
  start: () => Promise<void>;
  state: AgentForgeServer;
} {
  const configDir = resolve(options.configDir);
  const version = options.version ?? '0.1.0';

  // Auto-detect playground.html path: check common locations
  const playgroundPath = options.playgroundPath ?? resolve(configDir, '..', 'scripts', 'playground.html');

  const sessionStore = new InMemorySessionStore();
  const configStore = new FileConfigStore(configDir);
  const agentFactory = new AgentFactory();

  const serverState: AgentForgeServer = {
    configStore,
    sessionStore,
    agentFactory,
    configDir,
    version,
  };

  // Register all routes
  const router = new Router();

  // Session endpoints
  router.add('POST', '/api/sessions', createSession);
  router.add('GET', '/api/sessions', listSessions);
  router.add('GET', '/api/sessions/:id', getSession);
  router.add('DELETE', '/api/sessions/:id', deleteSession);
  router.add('POST', '/api/sessions/:id/clear', clearSession);
  router.add('POST', '/api/sessions/:id/chat/stream', chatStream);
  router.add('POST', '/api/sessions/:id/hitl/answer', hitlAnswer);
  router.add('POST', '/api/sessions/:id/cancel', cancelSession);

  // Agent config endpoints
  router.add('GET', '/api/agents', listAgents);
  router.add('GET', '/api/agents/:id', getAgent);
  router.add('PUT', '/api/agents/:id', saveAgent);
  router.add('DELETE', '/api/agents/:id', deleteAgent);

  // Config & health endpoints
  router.add('GET', '/api/config', getConfig);
  router.add('GET', '/health', healthCheck);
  router.add('GET', '/ready', readinessCheck);
  router.add('GET', '/metrics', metrics);

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res, router, serverState, playgroundPath);
    },
  );

  return {
    server: httpServer,
    start: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.listen(options.port ?? 3000, () => resolve());
        httpServer.on('error', reject);
      }),
    state: serverState,
  };
}

/**
 * Handle an incoming HTTP request by routing it to the appropriate handler.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  router: Router,
  serverState: AgentForgeServer,
  playgroundPath: string,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const pathWithQuery = url;

  // Try API routes first
  const match = router.resolve(method, pathWithQuery);
  if (match) {
    try {
      // Parse request body for methods that have one
      let body: unknown = undefined;
      if (method === 'POST' || method === 'PUT') {
        body = await parseBody(req);
      }

      const ctx: RequestContext = {
        server: serverState,
        params: match.params,
        query: match.query,
        body,
        headers: headersToObject(req.headers),
        request: incomingMessageToRequest(req),
      };

      const response = await match.handler(ctx);
      sendResponse(res, response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendResponse(res, Response.json({ error: message }, { status: 500 }));
    }
    return;
  }

  // Static file serving: playground.html
  const pathname = pathWithQuery.split('?')[0] ?? '/';
  if (pathname === '/' || pathname === '/playground' || pathname === '/playground.html') {
    await serveStaticFile(res, playgroundPath, 'text/html');
    return;
  }

  // Favicon or other static files from scripts/
  if (pathname.startsWith('/scripts/')) {
    const scriptsDir = resolve(playgroundPath, '..');
    const filePath = resolve(scriptsDir, pathname.slice('/scripts/'.length));
    const ext = extname(filePath);
    const contentType = getContentType(ext);
    await serveStaticFile(res, filePath, contentType);
    return;
  }

  // 404 Not Found
  sendResponse(res, Response.json({ error: 'Not found' }, { status: 404 }));
}

/**
 * Parse request body as JSON.
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Convert IncomingMessage headers to a plain object.
 */
function headersToObject(
  headers: IncomingMessage['headers'],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.join(', ');
    }
  }
  return result;
}

/**
 * Create a minimal Request object from IncomingMessage.
 * Only used for context — body is parsed separately.
 */
function incomingMessageToRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  return new Request(url, {
    method: req.method ?? 'GET',
    headers: headersToObject(req.headers) as Record<string, string>,
  });
}

/**
 * Send a Web API Response to a Node.js ServerResponse.
 *
 * Handles both regular JSON responses and SSE streaming responses.
 */
async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  // Set status code
  res.statusCode = response.status;

  // Set headers
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  // Handle body
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        res.write(chunk);
      }
    } catch {
      // Stream error — client may have disconnected
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
}

/**
 * Serve a static file from disk.
 */
async function serveStaticFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
): Promise<void> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      sendResponse(res, Response.json({ error: 'Not found' }, { status: 404 }));
      return;
    }
    const data = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', data.length);
    res.end(data);
  } catch {
    sendResponse(res, Response.json({ error: 'Not found' }, { status: 404 }));
  }
}

/**
 * Get content type from file extension.
 */
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  return types[ext] ?? 'application/octet-stream';
}