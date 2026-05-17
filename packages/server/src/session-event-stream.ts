import { serializeSSE } from './sse.js';
import type { AgentRegistry } from './registry.js';

/** Event types emitted by the agent pipeline that are relevant for session event streaming. */
const SESSION_EVENT_TYPES = [
  'iteration:end',
  'iteration.end',
  'tool:after',
  'tool.after',
  'error',
  'agent.start',
  'agent.end',
  'pipeline.complete',
  'stage.complete',
  'stage.start',
] as const;

export class SessionEventStream {
  constructor(private registry: AgentRegistry) {}

  /**
   * Subscribe to a session's events via SSE — long-lived ReadableStream.
   * Listens on the agent's eventBus and forwards matching events as SSE frames.
   */
  subscribe(sessionId: string): ReadableStream<Uint8Array> {
    const agent = this.registry.getAgentBySession(sessionId);
    if (!agent) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(serializeSSE({ type: 'error', message: 'No agent found for session' })));
          controller.close();
        },
      });
    }

    const eventBus = agent.eventBus;
    const unsubs: Array<() => void> = [];

    return new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        const handler = (data: unknown) => {
          if (!data || typeof data !== 'object') return;
          const payload = data as Record<string, unknown>;
          // Forward events that belong to this session
          if (payload.sessionId === sessionId || !payload.sessionId) {
            try {
              const sse = serializeSSE({ type: 'event', ...payload } as unknown as import('./sse.js').SSEMessage);
              controller.enqueue(encoder.encode(sse));
            } catch {
              // Ignore serialization errors
            }
          }
        };

        // Subscribe to all known session-relevant event types
        for (const eventType of SESSION_EVENT_TYPES) {
          unsubs.push(eventBus.subscribe(eventType, handler));
        }
      },
      cancel() {
        for (const unsub of unsubs) {
          unsub();
        }
        unsubs.length = 0;
      },
    });
  }

  /**
   * Stream agent execution for a prompt (combines continueStream + SSE).
   * Wraps the stream with session.started / session.completed events.
   */
  fromAgentContinue(sessionId: string, message: string): ReadableStream<Uint8Array> {
    const agent = this.registry.getAgentBySession(sessionId);

    if (!agent) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(serializeSSE({ type: 'error', message: 'No agent found for session' })));
          controller.close();
        },
      });
    }

    const abortController = new AbortController();

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();

        // Emit session.started
        controller.enqueue(encoder.encode(serializeSSE({
          type: 'session.started',
          sessionId,
        } as unknown as import('./sse.js').SSEMessage)));

        try {
          for await (const event of agent.continueStream(sessionId, message, abortController.signal)) {
            const sse = serializeSSE(event as unknown as import('./sse.js').SSEMessage);
            controller.enqueue(encoder.encode(sse));
          }

          // Emit session.completed
          controller.enqueue(encoder.encode(serializeSSE({
            type: 'session.completed',
            sessionId,
          } as unknown as import('./sse.js').SSEMessage)));
        } catch (err) {
          controller.enqueue(encoder.encode(serializeSSE({
            type: 'error',
            message: (err as Error).message,
          })));
        } finally {
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
      },
    });
  }
}
