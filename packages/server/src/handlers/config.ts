import type { RequestContext } from '../types.js';

/**
 * GET /api/config — return server configuration info
 *
 * Returns playground-compatible format:
 * - model: the model identifier (e.g. "openai/gpt-4o")
 * - baseUrl: the provider base URL if configured
 * - maxSteps: max agent steps
 * - tools: array of available tools with name/description
 */
export async function getConfig(ctx: RequestContext): Promise<Response> {
  // Load the first available agent config to populate model info
  const configs = await ctx.server.configStore.listAgentConfigs();
  const firstConfig = configs[0];

  // Build tools list from all configs (deduplicated by name)
  const toolMap = new Map<string, { name: string; description: string }>();
  for (const config of configs) {
    for (const tool of config.tools) {
      if (typeof tool === 'string') {
        if (!toolMap.has(tool)) {
          toolMap.set(tool, { name: tool, description: `${tool} tool` });
        }
      } else {
        if (!toolMap.has(tool.name)) {
          toolMap.set(tool.name, { name: tool.name, description: tool.name });
        }
      }
    }
  }

  return Response.json({
    version: ctx.server.version,
    configDir: ctx.server.configDir,
    // Playground-compatible fields (from first agent config or defaults)
    model: firstConfig
      ? `${firstConfig.model.provider}/${firstConfig.model.model}`
      : 'openai/gpt-4o',
    baseUrl: firstConfig?.model.baseUrl ?? '',
    maxSteps: firstConfig?.maxSteps ?? 10,
    tools: Array.from(toolMap.values()),
  });
}