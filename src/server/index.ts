import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { cors } from 'hono/cors';
import { createLogger } from '../logger/index.js';
import { authMiddleware } from './middleware/auth.js';
import { errorMiddleware } from './middleware/error.js';
import { loggingMiddleware } from './middleware/logging.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import type { Agent } from '../agent/agent.js';
import { createSessionAPI } from '../session/index.js';
import { toErrorResponse, AppError } from './error.js';
import { compactSession } from '../session/compaction.js';

const log = createLogger('server');
const sessionApi = createSessionAPI();

export interface ServerConfig {
  port?: number;
  apiKey?: string;
  corsOrigins?: string[];
  compactionThreshold?: number;
  compactionEnabled?: boolean;
}

export type AgentRunner = Agent;

export const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: { title: 'AgentForge API', version: '0.1.0', description: 'AI Agent Server API' },
  servers: [{ url: 'http://localhost:3000' }],
  paths: {
    '/health': {
      get: { summary: 'Health check', responses: { '200': { description: 'OK' } } },
    },
    '/api/agent/run': {
      post: {
        summary: 'Run agent synchronously',
        responses: { '200': { description: 'Success' } },
      },
    },
    '/api/agent/run/stream': {
      post: {
        summary: 'Run agent with streaming',
        responses: { '200': { description: 'Stream' } },
      },
    },
    '/api/agent/status': {
      get: { summary: 'Get agent status', responses: { '200': { description: 'Current status' } } },
    },
  },
};

export function createApp(config: ServerConfig & { agent?: AgentRunner }) {
  const { apiKey, agent, corsOrigins, compactionThreshold, compactionEnabled } = config;
  const app = new Hono();

  const COMPACTION_MSG_THRESHOLD = compactionThreshold ?? 20;
  const COMPACTION_ENABLED = compactionEnabled ?? true;

  (async () => {
    await sessionApi.init();
  })();

  app.use(
    '*',
    cors({
      origin: corsOrigins ?? '*',
    })
  );

  app.use('*', errorMiddleware);
  app.use('*', loggingMiddleware);
  app.use('*', rateLimitMiddleware());

  app.onError((err, c) => {
    const response = toErrorResponse(err);
    const status = err instanceof AppError ? err.status : 500;
    log.error('Request error', { error: err instanceof Error ? err.message : String(err), status });
    return c.json(response, status as any);
  });

  if (apiKey) {
    app.use('*', async (c, next) => {
      const authMw = authMiddleware({ apiKey });
      await authMw(c as any, next);
    });
  }

  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.get('/openapi.json', (c) => c.json(OPENAPI_SPEC));

  if (agent) {
    const agentApp = new Hono();

    agentApp.post('/run', async (c) => {
      const body = await c.req.json();
      const { input, sessionId } = body;
      log.info('Running agent', { input: input?.slice(0, 50), sessionId });

      try {
        let sessionMessages: any[] = [];
        if (sessionId) {
          const session = await sessionApi.get(sessionId);
          if (session) {
            sessionMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
          }
        }
        const result = await agent.run(input, { sessionMessages });
        return c.json({ result });
      } catch (err) {
        log.error('Agent run failed', { error: err instanceof Error ? err.message : String(err) });
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    });

    agentApp.post('/run/stream', async (c) => {
      const body = await c.req.json();
      const { input, sessionId } = body;
      log.info('Running agent stream', { input: input?.slice(0, 50), sessionId });

      let sessionMessages: any[] = [];
      if (sessionId) {
        const session = await sessionApi.get(sessionId);
        if (session) {
          sessionMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
        }
      }

      return streamSSE(c, async (stream) => {
        try {
          // 立即发送一个初始事件，确保响应流保持打开
          await stream.write(`data: {"type":"start"}\n\n`);

          let fullResponse = '';
          const completionPromise = new Promise<void>((resolve) => {
            agent.runStream(input, { sessionMessages }).subscribe({
              next: async (event) => {
                await stream.write(`data: ${JSON.stringify(event)}\n\n`);
                if (event.type === 'text' && event.content) {
                  fullResponse += event.content;
                }
              },
              complete: async () => {
                await stream.write(`data: {"type":"done"}\n\n`);

                if (sessionId && fullResponse) {
                  await sessionApi.addMessage(sessionId, { role: 'user', content: input });
                  await sessionApi.addMessage(sessionId, {
                    role: 'assistant',
                    content: fullResponse,
                  });

                  const session = await sessionApi.get(sessionId);
                  if (
                    COMPACTION_ENABLED &&
                    session &&
                    session.messages.length > COMPACTION_MSG_THRESHOLD
                  ) {
                    log.info('Compacting session', {
                      sessionId,
                      messageCount: session.messages.length,
                    });
                    const result = await compactSession(session, {
                      maxMessages: COMPACTION_MSG_THRESHOLD,
                    });
                    if (result.compactedMessages.length < session.messages.length) {
                      const compacted = result.compactedMessages;
                      await sessionApi.update(sessionId, { messages: compacted });
                      log.info('Session compacted', {
                        sessionId,
                        original: result.originalCount,
                        compacted: result.compactedMessages.length,
                      });
                    }
                  }
                }
                resolve();
              },
              error: async (err) => {
                const errorMsg = err instanceof Error ? err.message : String(err);
                log.error('Agent stream failed', { error: errorMsg });
                await stream.write(`data: {"type":"error","error":"${errorMsg}"}\n\n`);
                resolve();
              },
            });
          });

          await completionPromise;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          log.error('Agent stream failed', { error: errorMsg });
          await stream.write(`data: {"type":"error","error":"${errorMsg}"}\n\n`);
        }
      });
    });

    agentApp.get('/status', (c) => c.json(agent.getState()));
    app.route('/api/agent', agentApp);

    const sessionApp = new Hono();

    sessionApp.post('/', async (c) => {
      const body = await c.req.json();
      const { title, messages, parentId, projectId } = body;
      const session = await sessionApi.create({ title, messages, parentId, projectId });
      return c.json(session);
    });

    sessionApp.post('/:sessionID/run', async (c) => {
      const sessionId = c.req.param('sessionID');
      const body = await c.req.json();
      const { input } = body;
      log.info('Running agent', { input: input?.slice(0, 50), sessionId });

      try {
        let sessionMessages: any[] = [];
        const session = await sessionApi.get(sessionId);
        if (session) {
          sessionMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
        }
        const result = await agent.run(input, { sessionMessages });
        return c.json({ result });
      } catch (err) {
        log.error('Agent run failed', { error: err instanceof Error ? err.message : String(err) });
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    });

    sessionApp.post('/:sessionID/run/stream', async (c) => {
      const sessionId = c.req.param('sessionID');
      const body = await c.req.json();
      const { input } = body;
      log.info('Running agent stream', { input: input?.slice(0, 50), sessionId });

      let sessionMessages: any[] = [];
      const session = await sessionApi.get(sessionId);
      if (session) {
        sessionMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
      }

      return streamSSE(c, async (stream) => {
        try {
          // 立即发送一个初始事件，确保响应流保持打开
          await stream.write(`data: {"type":"start"}\n\n`);

          let fullResponse = '';
          const completionPromise = new Promise<void>((resolve) => {
            agent.runStream(input, { sessionMessages }).subscribe({
              next: async (event) => {
                await stream.write(`data: ${JSON.stringify(event)}\n\n`);
                if (event.type === 'text' && event.content) {
                  fullResponse += event.content;
                }
              },
              complete: async () => {
                await stream.write(`data: {"type":"done"}\n\n`);

                if (fullResponse) {
                  await sessionApi.addMessage(sessionId, { role: 'user', content: input });
                  await sessionApi.addMessage(sessionId, {
                    role: 'assistant',
                    content: fullResponse,
                  });

                  const session = await sessionApi.get(sessionId);
                  if (
                    COMPACTION_ENABLED &&
                    session &&
                    session.messages.length > COMPACTION_MSG_THRESHOLD
                  ) {
                    log.info('Compacting session', {
                      sessionId,
                      messageCount: session.messages.length,
                    });
                    const result = await compactSession(session, {
                      maxMessages: COMPACTION_MSG_THRESHOLD,
                    });
                    if (result.compactedMessages.length < session.messages.length) {
                      const compacted = result.compactedMessages;
                      await sessionApi.update(sessionId, { messages: compacted });
                      log.info('Session compacted', {
                        sessionId,
                        original: result.originalCount,
                        compacted: result.compactedMessages.length,
                      });
                    }
                  }
                }
                resolve();
              },
              error: async (err) => {
                const errorMsg = err instanceof Error ? err.message : String(err);
                log.error('Agent stream failed', { error: errorMsg });
                await stream.write(`data: {"type":"error","error":"${errorMsg}"}\n\n`);
                resolve();
              },
            });
          });

          await completionPromise;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          log.error('Agent stream failed', { error: errorMsg });
          await stream.write(`data: {"type":"error","error":"${errorMsg}"}\n\n`);
        }
      });
    });

    sessionApp.get('/', async (c) => {
      const limit = c.req.query('limit');
      const offset = c.req.query('offset');
      const parentId = c.req.query('parentId');
      const projectId = c.req.query('projectId');
      const sessions = await sessionApi.list({
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
        parentId,
        projectId,
      });
      return c.json(sessions);
    });

    sessionApp.get('/:id', async (c) => {
      const id = c.req.param('id');
      const session = await sessionApi.get(id);
      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json(session);
    });

    sessionApp.put('/:id', async (c) => {
      const id = c.req.param('id');
      const body = await c.req.json();
      const { title, messages, parentId, projectId } = body;
      const session = await sessionApi.update(id, { title, messages, parentId, projectId });
      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }
      return c.json(session);
    });

    sessionApp.delete('/:id', async (c) => {
      const id = c.req.param('id');
      const deleted = await sessionApi.delete(id);
      return c.json({ success: deleted });
    });

    app.route('/api/sessions', sessionApp);
  }

  log.info('App configured', { hasApiKey: !!apiKey, hasAgent: !!agent });
  return app;
}

export async function startServer(config: ServerConfig & { agent?: AgentRunner }) {
  const { port = 3000 } = config;
  const app = createApp(config);

  const httpModule = await import('http');

  const server = httpModule.createServer(async (nodeReq: any, nodeRes: any) => {
    const url = nodeReq.url || '/';
    const method = nodeReq.method || 'GET';

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(nodeReq.headers)) {
      if (value) headers[key] = Array.isArray(value) ? value[0] : value;
    }

    try {
      let body: ReadableStream | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        body = new ReadableStream({
          start(controller) {
            nodeReq.on('data', (chunk: Buffer) => controller.enqueue(chunk));
            nodeReq.on('end', () => controller.close());
            nodeReq.on('error', (err: Error) => controller.error(err));
          },
        });
      }

      const req = new Request(`http://localhost${url}`, {
        method,
        headers,
        body,
        duplex: 'half',
      } as unknown as Request);
      const res = await app.fetch(req);

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value: string, key: string) => {
        responseHeaders[key] = value;
      });

      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        nodeRes.writeHead(res.status, {
          ...responseHeaders,
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            nodeRes.write(value);
            // 确保数据立即发送（Node.js 12+ 支持）
            if (typeof nodeRes.flush === 'function') {
              nodeRes.flush();
            }
          }
          nodeRes.end();
        }
      } else {
        const text = await res.text();
        nodeRes.writeHead(res.status, responseHeaders);
        nodeRes.end(text);
      }
    } catch (err) {
      nodeRes.writeHead(500);
      nodeRes.end(err instanceof Error ? err.message : 'Internal Server Error');
    }
  });

  return new Promise((resolve: (server: any) => void) => {
    server.listen(port, () => {
      log.info('Server started', { port });
      resolve(server);
    });
  });
}
