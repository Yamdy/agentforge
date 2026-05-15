import type { StreamEvent } from './index.js';

export interface ClientOptions {
  url: string;
  apiKey?: string;
}

export interface AgentRunResult {
  response: string;
  tokenUsage: { input: number; output: number };
  sessionId: string;
}

export interface SSEMessage {
  type: string;
  [key: string]: unknown;
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

export class AgentForgeClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(options: ClientOptions) {
    this.baseUrl = options.url.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    if (options.apiKey) {
      this.headers['Authorization'] = `Bearer ${options.apiKey}`;
    }
  }

  async run(agentId: string, input: string): Promise<AgentRunResult> {
    const res = await fetch(`${this.baseUrl}/agents/${agentId}/run`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ input }),
    });
    return res.json() as Promise<AgentRunResult>;
  }

  async *stream(agentId: string, input: string, opts?: { mode?: 'text' | 'events' }): AsyncGenerator<string | StreamEvent> {
    const mode = opts?.mode ?? 'text';
    const res = await fetch(`${this.baseUrl}/agents/${agentId}/stream?mode=${mode}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ input }),
    });
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const msg of parseSSE(buffer)) {
        yield msg as unknown as StreamEvent;
      }
      const lastNewline = buffer.lastIndexOf('\n\n');
      if (lastNewline >= 0) buffer = buffer.slice(lastNewline + 2);
    }
  }

  async resume(agentId: string, sessionId: string): Promise<AgentRunResult> {
    const res = await fetch(`${this.baseUrl}/agents/${agentId}/resume`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ sessionId }),
    });
    return res.json() as Promise<AgentRunResult>;
  }

  async getSession(sessionId: string): Promise<{ sessionId: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      headers: this.headers,
    });
    return res.json() as Promise<{ sessionId: string; status: string }>;
  }
}
