import { Hono } from "hono";
import type { AgentRegistry } from "../registry.js";
import { serializeSSE, serializeSSEEvent } from "../sse.js";
import type { StreamEvent } from "@primo-ai/sdk";
import { validateAgentRunRequest, MAX_BODY_SIZE } from "./validate-request.js";

export function agentRoutes(registry: AgentRegistry): Hono {
  const app = new Hono();

  // List agents
  app.get("/", (c) => c.json(registry.list()));

  // Agent status
  app.get("/:id", (c) => {
    const agent = registry.get(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json({ id: c.req.param("id"), state: agent.state });
  });

  async function parseAndValidate(c: import("hono").Context) {
    const contentLength = c.req.header("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
      return { ok: false as const, response: c.json({ error: "Request body too large" }, 413) };
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return { ok: false as const, response: c.json({ error: "Invalid JSON in request body" }, 400) };
    }
    if (JSON.stringify(body).length > MAX_BODY_SIZE) {
      return { ok: false as const, response: c.json({ error: "Request body too large" }, 413) };
    }
    const validation = validateAgentRunRequest(body);
    if (!validation.valid) {
      return { ok: false as const, response: c.json({ error: validation.error }, validation.status as 400) };
    }
    return { ok: true as const, data: validation };
  }

  // Sync run
  app.post("/:id/run", async (c) => {
    const agentId = c.req.param("id");
    const agent = registry.get(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const parsed = await parseAndValidate(c);
    if (!parsed.ok) return parsed.response;
    const sessionId = parsed.data.sessionId;
    if (sessionId) {
      registry.registerSession(sessionId, agentId);
    }
    const result = await agent.run(parsed.data.input, sessionId ? { sessionId } : undefined);
    return c.json(result);
  });
  // SSE stream
  app.post("/:id/stream", async (c) => {
    const agentId = c.req.param("id");
    const agent = registry.get(agentId);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    const parsed = await parseAndValidate(c);
    if (!parsed.ok) return parsed.response;
    const sessionId = parsed.data.sessionId;
    if (sessionId) {
      registry.registerSession(sessionId, agentId);
    }
    const mode = new URL(c.req.url).searchParams.get("mode") === "events" ? "events" : "text";
    const input = parsed.data.input;
    const abortController = new AbortController();
    const signal = abortController.signal;
    const streamOptions = sessionId ? { sessionId, signal } : signal;
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          if (mode === "events") {
            for await (const event of agent.streamEvents(input, streamOptions)) {
              const sse = serializeSSEEvent(event as StreamEvent, "events");
              if (sse) controller.enqueue(encoder.encode(sse));
            }
          } else {
            for await (const text of agent.stream(input, streamOptions)) {
              controller.enqueue(encoder.encode(serializeSSE({ type: "text_delta", text })));
            }
          }
          controller.enqueue(encoder.encode(serializeSSE({ type: "complete" })));
        } catch (e) {
          controller.enqueue(encoder.encode(serializeSSE({ type: "error", message: (e as Error).message })));
        } finally {
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // Resume
  app.post("/:id/resume", async (c) => {
    const agent = registry.get(c.req.param("id"));
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON in request body" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }
    const obj = body as Record<string, unknown>;
    if (!("sessionId" in obj) || typeof obj.sessionId !== "string") {
      return c.json({ error: "Missing or invalid field: sessionId" }, 400);
    }
    const result = await agent.resume(obj.sessionId);
    return c.json(result);
  });

  return app;
}
