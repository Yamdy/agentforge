import type { RequestContext } from '../types.js';

/**
 * GET /health — health check
 */
export async function healthCheck(_ctx: RequestContext): Promise<Response> {
  return Response.json({ status: 'ok' });
}

/**
 * GET /ready — readiness check
 */
export async function readinessCheck(_ctx: RequestContext): Promise<Response> {
  return Response.json({ status: 'ready' });
}

/**
 * GET /metrics — basic metrics
 */
export async function metrics(_ctx: RequestContext): Promise<Response> {
  return Response.json({ uptime: process.uptime() });
}