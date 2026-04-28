import { observableToSSE } from '../sse.js';
import type { RequestContext } from '../types.js';
import type { L1AgentConfig } from '@primo512109/agentforge';

/**
 * POST /api/sessions — create a new session
 */
export async function createSession(ctx: RequestContext): Promise<Response> {
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const agentConfigId = typeof body.agentConfigId === 'string' ? body.agentConfigId : 'default';
  const configOverrides = body.configOverrides as
    | Partial<L1AgentConfig>
    | undefined;

  const session = ctx.server.sessionStore.create(
    agentConfigId,
    configOverrides,
  );

  return Response.json(sessionToJSON(session), { status: 201 });
}

/**
 * GET /api/sessions — list all sessions
 */
export async function listSessions(ctx: RequestContext): Promise<Response> {
  const sessions = ctx.server.sessionStore.list();
  return Response.json(sessions.map(sessionToJSON));
}

/**
 * GET /api/sessions/:id — get a session
 *
 * Supports pagination via query params:
 * - eventLimit: max number of events to return (default: all)
 * - eventOffset: offset into events array (default: 0)
 */
export async function getSession(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = ctx.server.sessionStore.get(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const json = sessionToJSON(session);

  // Apply event pagination
  const eventLimit = ctx.query.eventLimit
    ? parseInt(ctx.query.eventLimit, 10)
    : undefined;
  const eventOffset = ctx.query.eventOffset
    ? parseInt(ctx.query.eventOffset, 10)
    : 0;

  if (eventLimit !== undefined && !isNaN(eventLimit)) {
    const offset = isNaN(eventOffset) ? 0 : eventOffset;
    const events = json['events'] as unknown[];
    json['events'] = events.slice(offset, offset + eventLimit);
  }

  return Response.json(json);
}

/**
 * DELETE /api/sessions/:id — delete a session
 */
export async function deleteSession(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing session id' }, { status: 400 });
  }

  const deleted = ctx.server.sessionStore.delete(id);
  if (!deleted) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}

/**
 * POST /api/sessions/:id/clear — clear session messages and events
 */
export async function clearSession(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = ctx.server.sessionStore.get(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  ctx.server.sessionStore.clear(id);
  return Response.json({ success: true });
}

/**
 * POST /api/sessions/:id/chat/stream — SSE streaming chat
 *
 * Creates an ephemeral agent from the session's config, appends the user
 * message, and pipes agent.run$() to SSE.
 */
export async function chatStream(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = ctx.server.sessionStore.get(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  // Concurrency guard: only one active run per session
  if (session.activeRun) {
    return Response.json(
      { error: 'Session already has an active run' },
      { status: 409 },
    );
  }

  const body = ctx.body as Record<string, unknown> | null;
  const message = typeof body?.message === 'string' ? body.message : '';
  if (!message) {
    return Response.json({ error: 'Missing message' }, { status: 400 });
  }

  // Get the agent config from the config store
  const config = await ctx.server.configStore.getAgentConfig(
    session.agentConfigId,
  );
  if (!config) {
    return Response.json(
      { error: `Agent config '${session.agentConfigId}' not found` },
      { status: 404 },
    );
  }

  // Add user message to session
  const chatMessage = {
    role: 'user' as const,
    content: message,
    timestamp: new Date().toISOString(),
  };
  ctx.server.sessionStore.addMessage(id, chatMessage);

  // Create abort controller for this run
  const abortController = new AbortController();
  session.activeRun = abortController;

  // Build message history for agent (exclude the last message which is the
  // current user input — agent.run$() will append it automatically)
  const history = session.messages.slice(0, -1).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    // Create ephemeral agent with session history
    const agent = await ctx.server.agentFactory.create(config, {
      history,
      hitlController: session.hitlController,
    });

    // Run agent and stream events as SSE
    const events$ = agent.run$(message);
    return observableToSSE(events$, abortController.signal);
  } catch (err) {
    // Agent creation or run failed
    session.activeRun = null;
    const errorEvent = {
      type: 'agent.error' as const,
      timestamp: new Date().toISOString(),
      error: {
        name: err instanceof Error ? err.name : 'UnknownError',
        message: err instanceof Error ? err.message : String(err),
      },
    };
    const sseBody = `data: ${JSON.stringify(errorEvent)}\n\ndata: [DONE]\n\n`;
    return new Response(sseBody, {
      status: 500,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
}

/**
 * POST /api/sessions/:id/hitl/answer — provide HITL answer
 */
export async function hitlAnswer(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = ctx.server.sessionStore.get(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const body = ctx.body as Record<string, unknown> | null;
  const askId = typeof body?.askId === 'string' ? body.askId : '';
  const answer = typeof body?.answer === 'string' ? body.answer : '';

  if (!askId) {
    return Response.json({ error: 'Missing askId' }, { status: 400 });
  }

  session.hitlController.answer(askId, answer);
  return Response.json({ success: true });
}

/**
 * POST /api/sessions/:id/cancel — cancel an active run
 */
export async function cancelSession(ctx: RequestContext): Promise<Response> {
  const id = ctx.params.id;
  if (!id) {
    return Response.json({ error: 'Missing session id' }, { status: 400 });
  }

  const session = ctx.server.sessionStore.get(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  if (!session.activeRun) {
    return Response.json({ error: 'No active run to cancel' }, { status: 409 });
  }

  session.activeRun.abort();
  session.activeRun = null;
  return Response.json({ success: true });
}

/**
 * Convert a Session to a JSON-serializable object.
 * Strips non-serializable fields (hitlController, activeRun).
 */
function sessionToJSON(
  session: import('../types.js').Session,
): Record<string, unknown> {
  return {
    id: session.id,
    agentConfigId: session.agentConfigId,
    configOverrides: session.configOverrides,
    messages: session.messages,
    events: session.events,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}