import type { StreamEvent } from './index.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class AgentForgeClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'AgentForgeClientError';
    this.status = status;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export function isRetryableError(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface ClientOptions {
  url: string;
  apiKey?: string;
  retries?: number;
  retryDelay?: number;
}

export interface AgentRunResult {
  response: string;
  tokenUsage: { input: number; output: number };
  sessionId: string;
  compatRetries: number;
  content?: import("./index.js").ContentBlock[];
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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class AgentForgeClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private retries: number;
  private retryDelay: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.url.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    this.retries = options.retries ?? 0;
    this.retryDelay = options.retryDelay ?? 100;
    if (options.apiKey) {
      this.headers['Authorization'] = `Bearer ${options.apiKey}`;
    }
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let lastError: AgentForgeClientError | undefined;
    const maxAttempts = 1 + this.retries;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await delay(this.retryDelay * attempt); // linear backoff
      }

      let res: Response;
      try {
        res = await fetch(url, { ...init, headers: { ...this.headers, ...init.headers } });
      } catch (err) {
        throw new AgentForgeClientError(
          err instanceof Error ? err.message : 'Network request failed',
          0,
        );
      }

      if (!res.ok) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = undefined;
        }

        const message = (body as { error?: string })?.error ?? res.statusText;
        lastError = new AgentForgeClientError(message, res.status, body);

        if (isRetryableError(res.status) && attempt < this.retries) {
          continue; // retry
        }

        throw lastError;
      }

      return res.json() as Promise<T>;
    }

    throw lastError!;
  }

  async run(agentId: string, input: string): Promise<AgentRunResult> {
    return this.request<AgentRunResult>(
      `${this.baseUrl}/agents/${agentId}/run`,
      { method: 'POST', body: JSON.stringify({ input }) },
    );
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
    return this.request<AgentRunResult>(
      `${this.baseUrl}/agents/${agentId}/resume`,
      { method: 'POST', body: JSON.stringify({ sessionId }) },
    );
  }

  async getSession(sessionId: string): Promise<{ sessionId: string; status: string }> {
    return this.request<{ sessionId: string; status: string }>(
      `${this.baseUrl}/sessions/${sessionId}`,
      { method: 'GET' },
    );
  }
}
