import type { AgentEvent } from '@primo512109/agentforge';

interface Subscribable<T> {
  subscribe(observer: { next(v: T): void; error?(e: unknown): void; complete?(): void }): { unsubscribe(): void };
}

const encoder = new TextEncoder();

/**
 * Convert an Observable<AgentEvent> stream to an SSE Response.
 *
 * Handles:
 * - Normal events → `data: <JSON>\n\n`
 * - Terminal event → `data: [DONE]\n\n`
 * - Errors → `data: {"type":"agent.error",...}\n\n` + `data: [DONE]\n\n`
 * - Client disconnect (AbortSignal) → unsubscribe and close
 * - Memory cleanup → remove abort listener on all exit paths
 *
 * Note on error handling: The SSE error callback (in the Observable's error
 * handler below) only fires when the Observable itself throws an error (e.g.
 * agent.run$() throws before any events are emitted). Agent Loop internal
 * errors are emitted as `agent.error` events through the normal event channel,
 * which are mutually exclusive with this error handler.
 */
export function observableToSSE(
  events$: Subscribable<AgentEvent>,
  signal?: AbortSignal,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const cleanup = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        subscription.unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed — safe to ignore
        }
        cleanup();
      };

      const subscription = events$.subscribe({
        next: (event: AgentEvent) => {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
        error: (err: unknown) => {
          const errorEvent = {
            type: 'agent.error' as const,
            timestamp: new Date().toISOString(),
            error:
              err instanceof Error
                ? { name: err.name, message: err.message }
                : { name: 'UnknownError', message: String(err) },
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          cleanup();
        },
        complete: () => {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          cleanup();
        },
      });

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/**
 * Parse SSE text data into events (for testing and client-side parsing).
 *
 * This is a synchronous parser suitable for test environments.
 * The actual client SDK would use the streaming ReadableStream API.
 */
export function parseSSEStream(
  sseText: string,
  onEvent: (event: AgentEvent) => void,
  onDone?: () => void,
): void {
  const lines = sseText.split('\n');

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;

    const data = line.slice(6); // Remove 'data: ' prefix

    if (data === '[DONE]') {
      onDone?.();
      return;
    }

    try {
      const event = JSON.parse(data) as AgentEvent;
      onEvent(event);
    } catch {
      // Skip malformed events
    }
  }
}