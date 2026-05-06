/**
 * HTTP Transport for A2A Communication
 *
 * Uses fetch for sending POST requests and Server-Sent Events (SSE)
 * for receiving messages from the remote endpoint.
 *
 * Compatible with any A2A-compliant HTTP server that:
 * - Accepts POST /messages with JSON body
 * - Streams SSE events on GET /messages
 *
 * Node.js 18+ required (native fetch + ReadableStream).
 */

import type { A2AMessage } from './types.js';
import {
  type A2ATransport,
  type TransportStatus,
  type A2ATransportOptions,
  TransportConnectionError,
  TransportSendError,
} from './transport.js';

const decoder = new TextDecoder();

export class HTTPTransport implements A2ATransport {
  readonly name = 'http';
  readonly agentId: string;

  private _status: TransportStatus = 'disconnected';
  private readonly _statusListeners = new Set<(status: TransportStatus) => void>();
  private readonly _messageListeners = new Set<(msg: A2AMessage) => void>();

  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly connectTimeout: number;
  private abortController: AbortController | null = null;
  private sseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(options: A2ATransportOptions) {
    this.agentId = options.agentId;
    this.endpoint = options.endpoint;
    this.headers = { ...options.headers };
    this.connectTimeout = options.connectTimeout ?? 10000;
  }

  get status(): TransportStatus {
    return this._status;
  }

  onStatusChange(callback: (status: TransportStatus) => void): () => void {
    callback(this._status);
    this._statusListeners.add(callback);
    return () => {
      this._statusListeners.delete(callback);
    };
  }

  onMessage(callback: (msg: A2AMessage) => void): () => void {
    this._messageListeners.add(callback);
    return () => {
      this._messageListeners.delete(callback);
    };
  }

  private setStatus(status: TransportStatus): void {
    this._status = status;
    for (const listener of [...this._statusListeners]) {
      try {
        listener(status);
      } catch {
        /* isolate */
      }
    }
  }

  async connect(): Promise<void> {
    if (this._status === 'connected') return;

    this.setStatus('connecting');
    this.abortController = new AbortController();

    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, this.connectTimeout);

    try {
      const response = await fetch(this.endpoint, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...this.headers,
        },
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new TransportConnectionError(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new TransportConnectionError('Response body is null — SSE stream required');
      }

      this.setStatus('connected');
      this.sseReader = response.body.getReader();
      void this.readSSE();
    } catch (err) {
      clearTimeout(timeoutId);
      this.setStatus('error');

      if (err instanceof TransportConnectionError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new TransportConnectionError('Connection timed out');
      }
      throw new TransportConnectionError(
        `Failed to connect: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async readSSE(): Promise<void> {
    if (!this.sseReader) return;

    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await this.sseReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventData = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '' && eventData) {
            try {
              const msg = JSON.parse(eventData) as A2AMessage;
              for (const listener of [...this._messageListeners]) {
                try {
                  listener(msg);
                } catch {
                  /* isolate */
                }
              }
            } catch {
              /* skip malformed SSE event */
            }
            eventData = '';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.setStatus('error');
    }
  }

  async send(message: A2AMessage): Promise<void> {
    if (this._status !== 'connected') {
      throw new TransportSendError('Not connected');
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(message),
      signal: this.abortController?.signal ?? null,
    });

    if (!response.ok) {
      throw new TransportSendError(`Send failed: HTTP ${response.status}: ${response.statusText}`);
    }
  }

  async disconnect(): Promise<void> {
    this.abortController?.abort();
    await this.sseReader?.cancel().catch(() => {});
    this.sseReader = null;
    this.abortController = null;
    if (this._status !== 'disconnected') {
      this.setStatus('disconnected');
    }
  }

  destroy(): void {
    void this.disconnect();
    this._statusListeners.clear();
    this._messageListeners.clear();
  }
}
