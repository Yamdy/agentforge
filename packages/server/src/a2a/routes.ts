import { Hono } from 'hono';
import type { AgentRegistry } from '../registry.js';
import { A2ARequestHandler } from './server.js';
import { InMemoryTaskStore } from './task-store.js';
import { buildAgentCard } from './agent-card.js';
import type { AgentCardOptions } from './agent-card.js';
import type { A2AAgentCard } from './types.js';

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
    const request = await c.req.json();
    const response = await handler.handle(request);
    return c.json(response);
  });

  return { app, card };
}
