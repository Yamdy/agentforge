/**
 * MCP Streamable HTTP Transport
 *
 * Transport implementation using HTTP POST + SSE (Server-Sent Events).
 * Based on MCP specification 2025-11-25.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import type { MCPServerConfig } from '../core/interfaces.js';
import type { MCPTransport, TransportStatus } from './transport.js';
import { MCPConnectionError, MCPSendError } from './transport.js';
import type { JSONRPCMessage } from './types.js';
import { parseJSONRPCMessage } from './types.js';

// ============================================================
// HTTP Transport Config
// ============================================================

/**
 * Authentication provider interface.
 */
export interface AuthProvider {
  getAccessToken(): Promise<string>;
}

/**
 * Reconnection configuration.
 */
export interface ReconnectConfig {
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff growth factor */
  growFactor: number;
}

/**
 * Configuration for HTTP transport.
 */
export interface HTTPTransportConfig {
  /** MCP server URL */
  url: URL;
  /** Authentication provider */
  authProvider?: AuthProvider;
  /** Request initialization options */
  requestInit?: RequestInit;
  /** Protocol version */
  protocolVersion?: string;
  /** Reconnection configuration */
  reconnection?: Partial<ReconnectConfig>;
}

// ============================================================
// Default Configuration
// ============================================================

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  initialDelay: 1000,
  maxDelay: 30000,
  growFactor: 2,
};

// ============================================================
// Streamable HTTP Transport Implementation
// ============================================================

/**
 * Streamable HTTP Transport - based on HTTP POST + SSE.
 *
 * Protocol flow:
 * 1. POST /mcp - send request, may return JSON or SSE stream
 * 2. GET /mcp - establish SSE stream for server notifications
 * 3. DELETE /mcp - terminate session
 *
 * Session management: via mcp-session-id header
 */
export class StreamableHTTPTransport implements MCPTransport {
  private _sessionId: string | undefined;
  private _abortController?: AbortController;
  private _sseAbortController?: AbortController;
  private _status: TransportStatus = 'disconnected';
  private _sseReader?: ReadableStreamDefaultReader<Uint8Array>;

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  constructor(private config: HTTPTransportConfig) {}

  get status(): TransportStatus {
    return this._status;
  }

  /**
   * Establish SSE stream for server notifications.
   */
  async connect(): Promise<void> {
    if (this._status !== 'disconnected') {
      throw new MCPConnectionError('Transport already connected or connecting');
    }

    this._status = 'connecting';

    try {
      // Start SSE stream for server-initiated messages
      await this.startSSEStream();
      this._status = 'connected';
    } catch (error) {
      this._status = 'error';
      throw new MCPConnectionError(
        `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Send a JSON-RPC message via HTTP POST.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (this._status !== 'connected') {
      throw new MCPSendError('Transport not connected');
    }

    const headers = await this.buildHeaders();
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json, text/event-stream');

    // Include session ID if available
    if (this._sessionId !== undefined) {
      headers.set('mcp-session-id', this._sessionId);
    }

    this._abortController = new AbortController();

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: this._abortController.signal,
      });

      // Capture session ID from response
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId !== null) {
        this._sessionId = sessionId;
      }

      if (!response.ok) {
        throw new MCPSendError(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle response based on content type
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/event-stream')) {
        // SSE stream response (server-initiated messages)
        await this.handleSSEStream(response.body);
      } else if (contentType.includes('application/json')) {
        // Direct JSON response
        const data = await response.json();
        const parsed = parseJSONRPCMessage(data);
        if (parsed) {
          this.onmessage?.(parsed);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Ignore abort errors
        return;
      }
      throw error instanceof MCPSendError
        ? error
        : new MCPSendError(
            `Failed to send: ${error instanceof Error ? error.message : String(error)}`
          );
    }
  }

  /**
   * Close the connection gracefully.
   */
  async close(): Promise<void> {
    // Cancel ongoing requests
    this._abortController?.abort();
    this._sseAbortController?.abort();

    // Cancel SSE reader
    try {
      await this._sseReader?.cancel();
    } catch {
      // Ignore reader cancel errors
    }

    // Send DELETE to terminate session
    if (this._sessionId !== undefined) {
      try {
        const headers = await this.buildHeaders();
        headers.set('mcp-session-id', this._sessionId);

        await fetch(this.config.url, {
          method: 'DELETE',
          headers,
        });
      } catch {
        // Ignore termination errors
      }
      this._sessionId = undefined;
    }

    this._status = 'disconnected';
    this.onclose?.();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Start SSE stream for server notifications.
   */
  private async startSSEStream(): Promise<void> {
    this._sseAbortController = new AbortController();

    const headers = await this.buildHeaders();
    headers.set('accept', 'text/event-stream');

    if (this._sessionId !== undefined) {
      headers.set('mcp-session-id', this._sessionId);
    }

    const response = await fetch(this.config.url, {
      method: 'GET',
      headers,
      signal: this._sseAbortController.signal,
    });

    if (!response.ok) {
      throw new MCPConnectionError(`SSE connection failed: HTTP ${response.status}`);
    }

    // Process SSE stream in background
    this.handleSSEStream(response.body).catch(() => {
      if (this._status === 'connected') {
        this.scheduleReconnect();
      }
    });
  }

  /**
   * Handle SSE stream data.
   */
  private async handleSSEStream(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (body === null) {
      return;
    }

    this._sseReader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await this._sseReader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              const parsed: unknown = JSON.parse(data);
              const message = parseJSONRPCMessage(parsed);
              if (message) {
                this.onmessage?.(message);
              }
            } catch {
              // Ignore parse errors for SSE data
            }
          }
        }
      }
    } catch {
      // SSE stream interrupted
      if (this._status === 'connected') {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Schedule reconnection attempt.
   */
  private scheduleReconnect(attempt = 0): void {
    const { initialDelay, maxDelay, growFactor } = {
      ...DEFAULT_RECONNECT_CONFIG,
      ...this.config.reconnection,
    };

    const delay = Math.min(initialDelay * Math.pow(growFactor, attempt), maxDelay);

    setTimeout(() => {
      void this.reconnectAsync(attempt);
    }, delay);
  }

  /**
   * Async reconnection logic.
   */
  private async reconnectAsync(attempt: number): Promise<void> {
    if (this._status !== 'connected') return;

    try {
      await this.startSSEStream();
    } catch {
      this.scheduleReconnect(attempt + 1);
    }
  }

  /**
   * Build request headers.
   */
  private async buildHeaders(): Promise<Headers> {
    const headers = new Headers();

    // Add custom headers from config
    if (this.config.requestInit?.headers !== undefined) {
      const customHeaders = this.config.requestInit.headers;
      if (customHeaders instanceof Headers) {
        customHeaders.forEach((value, key) => headers.set(key, value));
      } else if (typeof customHeaders === 'object') {
        for (const [key, value] of Object.entries(customHeaders)) {
          if (typeof value === 'string') {
            headers.set(key, value);
          }
        }
      }
    }

    // Add authorization if provider is configured
    if (this.config.authProvider !== undefined) {
      const token = await this.config.authProvider.getAccessToken();
      headers.set('authorization', `Bearer ${token}`);
    }

    return headers;
  }
}

// ============================================================
// Factory Registration
// ============================================================

/**
 * Create an HTTP transport from MCPServerConfig.
 */
export function createHTTPTransport(config: MCPServerConfig): StreamableHTTPTransport {
  if (!config.url) {
    throw new MCPConnectionError('HTTP transport requires "url" in config');
  }

  return new StreamableHTTPTransport({
    url: new URL(config.url),
    protocolVersion: '2025-11-25',
  });
}

/**
 * Create an SSE transport from MCPServerConfig (alias for HTTP).
 */
export function createSSETransport(config: MCPServerConfig): StreamableHTTPTransport {
  return createHTTPTransport(config);
}
