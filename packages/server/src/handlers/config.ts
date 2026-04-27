import type { RequestContext } from '../types.js';

/**
 * GET /api/config — return server configuration info
 */
export async function getConfig(ctx: RequestContext): Promise<Response> {
  return Response.json({
    version: ctx.server.version,
    configDir: ctx.server.configDir,
  });
}