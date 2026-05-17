import type { StreamEvent } from '@primo-ai/sdk';

export interface SSEMessage {
  type: string;
  [key: string]: unknown;
}

export function serializeSSE(msg: SSEMessage): string {
  return `data: ${JSON.stringify(msg)}\n\n`;
}

export function serializeSSEEvent(event: StreamEvent, mode: 'text' | 'events'): string | null {
  if (mode === 'text') {
    if (event.type === 'text_delta') {
      return serializeSSE({ type: 'text_delta', text: event.text });
    }
    if (event.type === 'suspended') {
      return serializeSSE({ type: 'suspended', reason: (event as { reason: string }).reason });
    }
    return null;
  }

  // events mode — forward all events
  return serializeSSE(event as unknown as SSEMessage);
}

export function* parseSSE(raw: string): Generator<SSEMessage> {
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    try {
      yield JSON.parse(trimmed.slice(6));
    } catch { /* skip malformed lines */ }
  }
}
