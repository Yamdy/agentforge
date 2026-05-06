import type { AgentEvent } from '@primo512109/agentforge';

const encoder = new TextEncoder();

/**
 * Callback-based event stream subscriber.
 *
 * @param onEvent — called for each event in the stream
 * @param onError — called if the stream encounters an unrecoverable error
 * @param onComplete — called when the stream ends normally
 * @returns unsubscribe function — call to stop receiving events
 */
export type EventSubscriber = (
  onEvent: (event: AgentEvent) => void,
  onError: (err: unknown) => void,
  onComplete: () => void,
) => () => void;

/**
 * Convert a callback-based event stream to an SSE Response.
 *
 * Handles:
 * - Normal events → `data: <JSON>\n\n`
 * - Terminal event → `data: [DONE]\n\n`
 * - Errors → `data: {"type":"agent.error",...}\n\n` + `data: [DONE]\n\n`
 * - Client disconnect (AbortSignal) → unsubscribe and close
 * - Memory cleanup → remove abort listener on all exit paths
 */
export function streamToSSE(
  subscribe: EventSubscriber,
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
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed — safe to ignore
        }
        cleanup();
      };

      const unsubscribe = subscribe(
        (event: AgentEvent) => {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        },
        (err: unknown) => {
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
        () => {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          cleanup();
        },
      );

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
