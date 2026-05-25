import { api } from './client';
import type { StudioAgentDetail } from '../types';

export async function fetchStudioAgents(): Promise<{ agents: StudioAgentDetail[] }> {
  return api('/agents');
}

export async function fetchStudioAgent(id: string): Promise<StudioAgentDetail> {
  return api(`/agents/${id}`);
}

export async function sendChatMessage(
  sessionId: string,
  message: string,
): Promise<ReadableStream<Uint8Array>> {
  const resp = await fetch(`/api/studio/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) throw new Error(`Chat request failed: ${resp.status}`);
  return resp.body!;
}

export async function abortSession(sessionId: string): Promise<{ aborted: boolean }> {
  return api(`/sessions/${sessionId}/abort`, { method: 'POST' });
}

export function createEventSource(sessionId: string): EventSource {
  return new EventSource(`/api/studio/sessions/${sessionId}/events`);
}
