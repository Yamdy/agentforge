import type { RequestContext } from '../types.js';

/**
 * GET /api/agents — list all agent configs
 */
export async function listAgents(ctx: RequestContext): Promise<Response> {
  const configs = await ctx.server.configStore.listAgentConfigs();
  return Response.json(
    configs.map((c) => ({ id: c.name, name: c.name, model: c.model })),
  );
}

/**
 * GET /api/agents/:id — get a specific agent config
 */
export async function getAgent(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing agent id' }, { status: 400 });
  }

  const config = await ctx.server.configStore.getAgentConfig(id);
  if (!config) {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  return Response.json(config);
}

/**
 * PUT /api/agents/:id — create or update an agent config
 */
export async function saveAgent(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing agent id' }, { status: 400 });
  }

  try {
    await ctx.server.configStore.saveAgentConfig(id, ctx.body);
    const saved = await ctx.server.configStore.getAgentConfig(id);
    return Response.json(saved, { status: saved ? 200 : 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid config';
    return Response.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/agents/:id — delete an agent config
 */
export async function deleteAgent(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing agent id' }, { status: 400 });
  }

  const deleted = await ctx.server.configStore.deleteAgentConfig(id);
  if (!deleted) {
    return Response.json({ error: 'Agent not found' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}