/**
 * WebSocket Transport for A2A Communication
 *
 * Uses the native WebSocket API (Node.js 22+) for bidirectional
 * agent-to-agent communication.
 *
 * Each message is serialized as JSON and sent as a WebSocket text frame.
 * Incoming text frames are parsed as A2AMessage objects.
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

export class WebSocketTransport implements A2ATransport {
  readonly name = 'websocket';
  readonly agentId: string;

  private _status: TransportStatus = 'disconnected';
  private readonly _statusListeners = new Set<(status: TransportStatus) => void>();
  private readonly _messageListeners = new Set<(msg: A2AMessage) => void>();

  private readonly endpoint: string;
  private readonly connectTimeout: number;
  private ws: WebSocket | null = null;

  constructor(options: A2ATransportOptions) {
    this.agentId = options.agentId;
    this.endpoint = options.endpoint;
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

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new TransportConnectionError('WebSocket connection timed out'));
      }, this.connectTimeout);

      try {
        this.ws = new WebSocket(this.endpoint);
      } catch (err) {
        clearTimeout(timeout);
        this.setStatus('error');
        reject(
          new TransportConnectionError(
            `WebSocket constructor failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        return;
      }

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.setStatus('connected');
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data =
            typeof event.data === 'string' ? event.data : decoder.decode(event.data as ArrayBuffer);
          const message = JSON.parse(data) as A2AMessage;
          for (const listener of [...this._messageListeners]) {
            try {
              listener(message);
            } catch {
              /* isolate */
            }
          }
        } catch {
          /* skip malformed messages */
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        if (this._status === 'connecting') {
          this.setStatus('error');
          reject(new TransportConnectionError('WebSocket connection failed'));
        } else {
          this.setStatus('error');
        }
      };

      this.ws.onclose = () => {
        if (this._status === 'connected' || this._status === 'error') {
          this.setStatus('disconnected');
        }
      };
    });
  }

  send(message: A2AMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new TransportSendError('WebSocket is not connected'));
    }

    try {
      this.ws.send(JSON.stringify(message));
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(
        new TransportSendError(
          `WebSocket send failed: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }

  disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    if (this._status !== 'disconnected') {
      this.setStatus('disconnected');
    }
    return Promise.resolve();
  }

  destroy(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close(1000, 'Destroy');
      this.ws = null;
    }
    this._statusListeners.clear();
    this._messageListeners.clear();
  }
}
