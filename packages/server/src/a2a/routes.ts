import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { AgentRegistry } from '../registry.js';
import { A2ARequestHandler } from './server.js';
import { InMemoryTaskStore } from './task-store.js';
import { buildAgentCard } from './agent-card.js';
import type { AgentCardOptions } from './agent-card.js';
import type { A2AAgentCard, JsonRpcRequest } from './types.js';

export interface A2ARoutesOptions {
  registry: AgentRegistry;
  agentId: string;
  cardOptions: Omit<AgentCardOptions, 'tools'>;
}

export function a2aRoutes(options: A2ARoutesOptions): { app: Hono; card: A2AAgentCard } {
  const app = new Hono();
  const agent = options.registry.get(options.agentId);
  if (!agent) throw new Error(`Agent not found: ${options.agentId}`);

  const taskStore = new InMemoryTaskStore();
  const handler = new A2ARequestHandler({ agent, taskStore });

  const schemas = agent.toolRegistry.toAiSdkToolSchemas();
  const card = buildAgentCard({
    ...options.cardOptions,
    tools: Object.entries(schemas).map(([name, s]) => ({ name, description: s.description })),
  });

  app.get('/.well-known/agent-card.json', (c) => c.json(card));

  app.post('/jsonrpc', async (c) => {
    const request: JsonRpcRequest = await c.req.json();

    // Streaming JSON-RPC: return SSE events
    if (request.method === 'SendTaskStreaming') {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');

      return stream(c, async (s) => {
        try {
          const params = request.params as { message: any };
          for await (const event of handler.streamSendMessage({ message: params.message })) {
            const sseData = JSON.stringify({
              jsonrpc: '2.0',
              id: request.id ?? null,
              result: event,
            });
            s.write(`data: ${sseData}\n\n`);
          }
        } catch (err) {
          const errorData = JSON.stringify({
            jsonrpc: '2.0',
            id: request.id ?? null,
            error: { code: -32006, message: (err as Error).message },
          });
          s.write(`data: ${errorData}\n\n`);
        }
      });
    }

    // Standard (non-streaming) JSON-RPC
    const response = await handler.handle(request);
    return c.json(response);
  });

  return { app, card };
}

// ---------------------------------------------------------------------------
// Multi-Agent A2A Routes
// ---------------------------------------------------------------------------

export interface MultiAgentCardOptions {
  name: string;
  description: string;
  url: string;
  version: string;
}

export interface A2AMultiAgentRoutesOptions {
  registry: AgentRegistry;
  agents: Record<string, MultiAgentCardOptions>;
}

/**
 * Create a single Hono app that routes to multiple agents.
 * Each agent gets its own path prefix, task store, and agent card.
 *
 * Routes:
 *   /:agentId/.well-known/agent-card.json  — Agent Card
 *   /:agentId/jsonrpc                        — JSON-RPC (sync + streaming)
 */
export function a2aMultiAgentRoutes(options: A2AMultiAgentRoutesOptions): Hono {
  const app = new Hono();

  for (const [agentId, cardOpts] of Object.entries(options.agents)) {
    const agent = options.registry.get(agentId);
    if (!agent) continue; // skip unregistered agents

    const taskStore = new InMemoryTaskStore();
    const handler = new A2ARequestHandler({ agent, taskStore });

    const schemas = agent.toolRegistry.toAiSdkToolSchemas();
    const card = buildAgentCard({
      ...cardOpts,
      tools: Object.entries(schemas).map(([name, s]) => ({ name, description: s.description })),
    });

    const agentApp = new Hono();

    agentApp.get('/.well-known/agent-card.json', (c) => c.json(card));

    agentApp.post('/jsonrpc', async (c) => {
      const request: JsonRpcRequest = await c.req.json();

      if (request.method === 'SendTaskStreaming') {
        c.header('Content-Type', 'text/event-stream');
        c.header('Cache-Control', 'no-cache');

        return stream(c, async (s) => {
          try {
            const params = request.params as { message: any };
            for await (const event of handler.streamSendMessage({ message: params.message })) {
              const sseData = JSON.stringify({
                jsonrpc: '2.0',
                id: request.id ?? null,
                result: event,
              });
              s.write(`data: ${sseData}\n\n`);
            }
          } catch (err) {
            const errorData = JSON.stringify({
              jsonrpc: '2.0',
              id: request.id ?? null,
              error: { code: -32006, message: (err as Error).message },
            });
            s.write(`data: ${errorData}\n\n`);
          }
        });
      }

      const response = await handler.handle(request);
      return c.json(response);
    });

    app.route(`/${agentId}`, agentApp);
  }

  return app;
}
