/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * A2A Client - High-Level Agent-to-Agent Communication API
 *
 * Provides a simple API for cross-process agent communication.
 * Integrates with Agent Loop via callback-based subscriptions.
 * Callback-based API.
 *
 */

import { generateId } from '../core/events.js';
import {
  type A2AMessage,
  A2A_BROADCAST_TARGET,
  A2A_PROTOCOL_VERSION,
  A2A_DEFAULT_TTL,
} from './types.js';
import { isMessageExpired } from './message.js';
import { type A2ATransport, type TransportStatus, TransportError } from './transport.js';
import type { Subscribable } from './transport.js';
import { A2AConnection, type A2AConnectionOptions, createConnection } from './connection.js';

// ============================================================
// Client Events
// ============================================================

/**
 * A2A client event types for observability.
 */
export type A2AClientEventType =
  | 'a2a.client.started'
  | 'a2a.client.stopped'
  | 'a2a.client.request_sent'
  | 'a2a.client.response_received'
  | 'a2a.client.notification_sent'
  | 'a2a.client.broadcast_sent'
  | 'a2a.client.error_received'
  | 'a2a.client.timeout'
  | 'a2a.client.message_dropped';

/**
 * A2A client event for logging/debugging.
 */
export interface A2AClientEvent {
  type: A2AClientEventType;
  timestamp: number;
  agentId: string;
  details?: Record<string, unknown>;
}

/**
 * A2A error event (errors-as-events pattern).
 */
export interface A2AClientErrorEvent {
  type: 'a2a.client.error';
  timestamp: number;
  agentId: string;
  error: {
    code: string;
    message: string;
    correlationId?: string | undefined;
  };
}

// ============================================================
// Request Options
// ============================================================

/**
 * Options for request operations.
 */
export interface RequestOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Time-to-live for the message */
  ttl?: number;
  /** Sequence number for ordered delivery */
  sequence?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for notification operations.
 */
export interface NotifyOptions {
  /** Time-to-live for the message */
  ttl?: number;
  /** Sequence number for ordered delivery */
  sequence?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Message Handler
// ============================================================

/**
 * Handler function for processing incoming messages.
 */
export type A2AMessageHandler = (
  message: A2AMessage,
  client: A2AClient
) => Promise<A2AMessage | void>;

/**
 * Subscription to incoming messages.
 */
export interface A2AMessageSubscription {
  /** Unsubscribe from messages */
  unsubscribe(): void;
}

// ============================================================
// A2A Client Configuration
// ============================================================

/**
 * A2A Client configuration options.
 */
export interface A2AClientOptions {
  /** Agent ID for this client */
  agentId: string;
  /** Transport to use for communication */
  transport: A2ATransport;
  /** Default request timeout in milliseconds */
  defaultTimeout?: number;
  /** Handler for incoming messages */
  messageHandler?: A2AMessageHandler;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================
// A2A Client Class
// ============================================================

/**
 * A2AClient - High-level API for Agent-to-Agent communication.
 *
 * This is a peer-to-peer client that can:
 * - Send requests and await responses
 * - Send notifications (one-way)
 * - Broadcast messages to all agents
 * - Subscribe to incoming messages
 *
 * Errors are emitted as events (errors-as-events pattern), never thrown
 * to the error channel.
 *
 * Callback-based API:
 * - onEvent(fn) replaces events$ observable
 * - onStatus(fn) replaces status$ observable
 * - onMessage(fn) replaces messages$ observable
 */
export class A2AClient {
  /** Agent ID for this client */
  readonly agentId: string;

  /** Default request timeout */
  private readonly defaultTimeout: number;

  /** Underlying connection */
  private readonly connection: A2AConnection;

  /** Message handler */
  private messageHandler?: A2AMessageHandler;

  /** Event listeners */
  private readonly _eventListeners = new Set<
    (event: A2AClientEvent | A2AClientErrorEvent) => void
  >();

  /** Started flag */
  private _started = false;

  /** Stopped flag */
  private _stopped = false;

  /** Cleanup functions for subscriptions */
  private _cleanups: (() => void)[] = [];

  /**
   * Register a callback for client events.
   * Returns an unsubscribe function.
   */
  onEvent(callback: (event: A2AClientEvent | A2AClientErrorEvent) => void): () => void {
    this._eventListeners.add(callback);
    return () => {
      this._eventListeners.delete(callback);
    };
  }

  /**
   * Register a callback for status changes.
   * Returns an unsubscribe function. Replays current value.
   */
  onStatus(callback: (status: TransportStatus) => void): () => void {
    return this.connection.onStatus(callback);
  }

  /**
   * Register a callback for incoming messages.
   * Returns an unsubscribe function.
   */
  onMessage(callback: (msg: A2AMessage) => void): () => void {
    return this.connection.onMessage(callback);
  }

  /**
   * Current connection status.
   */
  get status(): TransportStatus {
    return this.connection.status;
  }

  /**
   * Is client started and connected.
   */
  get isStarted(): boolean {
    return this._started;
  }

  /**
   * Is connection active.
   */
  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  constructor(options: A2AClientOptions) {
    this.agentId = options.agentId;
    this.defaultTimeout = options.defaultTimeout ?? 30000;
    if (options.messageHandler !== undefined) {
      this.messageHandler = options.messageHandler;
    }

    // Create connection options with explicit values for exactOptionalPropertyTypes
    const connectionOptions: A2AConnectionOptions = {
      transport: options.transport,
      agentId: options.agentId,
    };
    if (options.debug !== undefined) {
      connectionOptions.debug = options.debug;
    }

    // Create connection
    this.connection = createConnection(connectionOptions);
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Start the client and connect to remote endpoint.
   */
  async start(): Promise<void> {
    if (this._started) {
      return;
    }

    try {
      await this.connection.connect();
      this._started = true;
      this.emitEvent('a2a.client.started', {});
      this.startMessageHandling();
    } catch (error) {
      this.emitError(
        'START_ERROR',
        error instanceof Error ? error.message : 'Failed to start client'
      );
      throw error;
    }
  }

  /**
   * Stop the client and disconnect.
   */
  async stop(): Promise<void> {
    if (!this._started) {
      return;
    }

    this.stopMessageHandling();
    await this.connection.disconnect();
    this._started = false;
    this.emitEvent('a2a.client.stopped', {});
  }

  /**
   * Destroy the client and release all resources.
   */
  destroy(): void {
    this._stopped = true;

    this.stopMessageHandling();
    this.connection.destroy();
    this._started = false;

    // Run all cleanups
    for (const cleanup of this._cleanups) {
      try {
        cleanup();
      } catch {
        /* ignore */
      }
    }
    this._cleanups = [];

    this._eventListeners.clear();
  }

  // ============================================================
  // Request-Response Pattern
  // ============================================================

  /**
   * Send a request and subscribe to the response.
   *
   * Returns a Subscribable that:
   * - Emits the response message on success
   * - Emits an error message if the remote agent returns an error
   * - Times out if no response is received within timeout
   *
   * Errors are emitted as events, not thrown.
   */
  request(targetId: string, payload: unknown, options?: RequestOptions): Subscribable<A2AMessage> {
    const timeoutMs = options?.timeout ?? this.defaultTimeout;
    const requestId = generateId('req');
    const self = this;

    return {
      subscribe(observer: {
        next?: (v: A2AMessage) => void;
        error?: (e: Error) => void;
        complete?: () => void;
      }): { unsubscribe(): void } {
        const next = observer.next ?? (() => {});
        const complete = observer.complete ?? (() => {});
        let settled = false;
        let clientTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let innerUnsub: { unsubscribe(): void } | null = null;

        self.emitEvent('a2a.client.request_sent', {
          requestId,
          targetId,
          timeout: timeoutMs,
        });

        // Client-side timeout (safety net; connection also has its own timeout)
        clientTimeoutId = setTimeout(() => {
          if (self._stopped || settled) return;
          settled = true;
          if (innerUnsub) innerUnsub.unsubscribe();
          self.emitEvent('a2a.client.timeout', { requestId, targetId });
          const timeoutMsg: A2AMessage = {
            id: generateId('timeout'),
            from: targetId,
            to: self.agentId,
            timestamp: Date.now(),
            ttl: 0,
            correlationId: requestId,
            type: 'error' as const,
            payload: { code: 'TIMEOUT', message: `Request timed out after ${timeoutMs}ms` },
            version: A2A_PROTOCOL_VERSION,
          };
          next(timeoutMsg);
          complete();
        }, timeoutMs);

        // Subscribe to connection request
        innerUnsub = self.connection.request(targetId, payload, { timeout: timeoutMs }).subscribe({
          next: (response: A2AMessage) => {
            if (self._stopped || settled) return;
            settled = true;

            // Clear client timeout since we got a response
            if (clientTimeoutId !== null) {
              clearTimeout(clientTimeoutId);
              clientTimeoutId = null;
            }

            // Emit events based on response type
            if (response.type === 'response') {
              self.emitEvent('a2a.client.response_received', {
                requestId,
                responseId: response.id,
              });
            } else if (response.type === 'error') {
              self.emitEvent('a2a.client.error_received', {
                requestId,
                error: response.payload,
              });
            }

            next(response);
            complete();
          },
          error: (err: unknown) => {
            if (self._stopped || settled) return;
            settled = true;

            if (clientTimeoutId !== null) {
              clearTimeout(clientTimeoutId);
              clientTimeoutId = null;
            }

            // Convert error to error event/message
            const errMsg = err instanceof Error ? err.message : String(err);
            self.emitError('REQUEST_ERROR', errMsg, requestId);
            const errorMsg: A2AMessage = {
              id: generateId('err'),
              from: targetId,
              to: self.agentId,
              timestamp: Date.now(),
              ttl: 0,
              correlationId: requestId,
              type: 'error' as const,
              payload: { code: 'REQUEST_ERROR', message: errMsg },
              version: A2A_PROTOCOL_VERSION,
            };
            next(errorMsg);
            complete();
          },
        });

        return {
          unsubscribe() {
            if (clientTimeoutId !== null) {
              clearTimeout(clientTimeoutId);
              clientTimeoutId = null;
            }
            if (innerUnsub) {
              innerUnsub.unsubscribe();
              innerUnsub = null;
            }
            settled = true;
          },
        };
      },
    };
  }

  /**
   * Send a request and get a Promise for the response.
   */
  async requestAsync(
    targetId: string,
    payload: unknown,
    options?: RequestOptions
  ): Promise<A2AMessage> {
    return new Promise((resolve, reject) => {
      const sub = this.request(targetId, payload, options).subscribe({
        next: response => {
          sub.unsubscribe();
          if (response.type === 'error') {
            const errorPayload = response.payload as { code: string; message: string };
            reject(new TransportError(errorPayload.message, errorPayload.code, false));
          } else {
            resolve(response);
          }
        },
        error: reject,
      });
    });
  }

  /**
   * Send a response to a received request.
   */
  async respond(requestMessage: A2AMessage, payload: unknown): Promise<void> {
    return this.connection.respond(requestMessage, payload);
  }

  // ============================================================
  // Notification Pattern
  // ============================================================

  /**
   * Send a one-way notification (no response expected).
   */
  async notify(targetId: string, payload: unknown, options?: NotifyOptions): Promise<void> {
    const notificationId = generateId('notify');

    const notification: A2AMessage = {
      id: notificationId,
      from: this.agentId,
      to: targetId,
      timestamp: Date.now(),
      ttl: options?.ttl ?? A2A_DEFAULT_TTL,
      type: 'notification',
      payload,
      version: A2A_PROTOCOL_VERSION,
      sequence: options?.sequence,
      metadata: options?.metadata,
    };

    this.emitEvent('a2a.client.notification_sent', {
      notificationId,
      targetId,
    });

    return this.connection.send(notification);
  }

  /**
   * Send a broadcast to all connected agents.
   */
  async broadcast(payload: unknown, options?: NotifyOptions): Promise<void> {
    const broadcastId = generateId('broadcast');

    const message: A2AMessage = {
      id: broadcastId,
      from: this.agentId,
      to: A2A_BROADCAST_TARGET,
      timestamp: Date.now(),
      ttl: options?.ttl ?? A2A_DEFAULT_TTL,
      type: 'notification',
      payload,
      version: A2A_PROTOCOL_VERSION,
      sequence: options?.sequence,
      metadata: options?.metadata,
    };

    this.emitEvent('a2a.client.broadcast_sent', {
      broadcastId,
    });

    return this.connection.send(message);
  }

  // ============================================================
  // Message Handling
  // ============================================================

  /**
   * Set a handler for incoming messages.
   */
  setMessageHandler(handler: A2AMessageHandler): void {
    this.messageHandler = handler;
    if (this._started && this._cleanups.every(c => c !== this._messageHandlingCleanup)) {
      this.startMessageHandling();
    }
  }

  // Track whether the message handling subscription is active
  private _messageHandlingCleanup: (() => void) | null = null;

  /**
   * Subscribe to messages matching a filter.
   */
  subscribe(filterFn: (message: A2AMessage) => boolean = () => true): A2AMessageSubscription {
    const self = this;
    const cleanup = this.connection.onMessage((message: A2AMessage) => {
      if (self._stopped) return;
      if (!filterFn(message)) return;
      void self.handleMessageInternal(message);
    });

    return {
      unsubscribe() {
        cleanup();
      },
    };
  }

  /**
   * Subscribe to requests only.
   */
  subscribeRequests(
    handler: (message: A2AMessage) => Promise<A2AMessage | void>
  ): A2AMessageSubscription {
    const self = this;
    const cleanup = this.connection.onMessage((message: A2AMessage) => {
      if (self._stopped) return;
      if (message.type !== 'request' || message.to !== self.agentId) return;

      // Fire and forget handler (concurrent processing like mergeMap)
      handler(message)
        .then(result => {
          if (result) {
            return self.connection.send(result);
          }
          return undefined;
        })
        .catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'Handler error';
          self.connection.respondError(message, 'HANDLER_ERROR', errorMessage).catch(() => {});
          self.emitError('HANDLER_ERROR', errorMessage, message.id);
        });
    });

    return {
      unsubscribe() {
        cleanup();
      },
    };
  }

  // ============================================================
  // Connection Access
  // ============================================================

  /**
   * Get the underlying connection for advanced operations.
   */
  getConnection(): A2AConnection {
    return this.connection;
  }

  /**
   * Get pending request IDs.
   */
  getPendingRequestIds(): string[] {
    return this.connection.getPendingRequestIds();
  }

  /**
   * Cancel a pending request.
   */
  cancelRequest(requestId: string): boolean {
    return this.connection.cancelRequest(requestId);
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Start handling incoming messages.
   */
  private startMessageHandling(): void {
    if (this._messageHandlingCleanup) {
      return;
    }

    const self = this;
    this._messageHandlingCleanup = this.connection.onMessage((message: A2AMessage) => {
      if (self._stopped) return;
      if (message.to !== self.agentId && message.to !== A2A_BROADCAST_TARGET) return;
      void self.handleMessageInternal(message);
    });
  }

  /**
   * Stop handling incoming messages.
   */
  private stopMessageHandling(): void {
    if (this._messageHandlingCleanup) {
      this._messageHandlingCleanup();
      this._messageHandlingCleanup = null;
    }
  }

  /**
   * Handle an incoming message internally.
   */
  private async handleMessageInternal(message: A2AMessage): Promise<void> {
    // Skip expired messages
    if (isMessageExpired(message)) {
      this.emitEvent('a2a.client.message_dropped', {
        messageId: message.id,
        reason: 'expired',
      });
      return;
    }

    // Invoke user handler if set
    if (this.messageHandler) {
      try {
        const result = await this.messageHandler(message, this);
        if (result) {
          await this.connection.send(result);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Handler error';
        this.emitError('HANDLER_ERROR', errorMessage, message.id);
      }
    }
  }

  /**
   * Emit a client event.
   */
  private emitEvent(type: A2AClientEventType, details: Record<string, unknown>): void {
    const event: A2AClientEvent = {
      type,
      timestamp: Date.now(),
      agentId: this.agentId,
      details,
    };
    for (const listener of this._eventListeners) {
      listener(event);
    }
  }

  /**
   * Emit an error event (errors-as-events pattern).
   */
  private emitError(code: string, message: string, correlationId?: string | undefined): void {
    const errorPayload: { code: string; message: string; correlationId?: string | undefined } = {
      code,
      message,
    };
    if (correlationId !== undefined) {
      errorPayload.correlationId = correlationId;
    }
    const errorEvent: A2AClientErrorEvent = {
      type: 'a2a.client.error',
      timestamp: Date.now(),
      agentId: this.agentId,
      error: errorPayload,
    };
    for (const listener of this._eventListeners) {
      listener(errorEvent);
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create an A2A client.
 */
export function createClient(options: A2AClientOptions): A2AClient {
  return new A2AClient(options);
}

// ============================================================
// Mock Transport for Testing
// ============================================================

/**
 * Mock transport for testing purposes.
 * This should NOT be used in production.
 * Callback-based.
 */
export class MockTransport implements A2ATransport {
  readonly name = 'mock';
  readonly agentId: string;

  private _status: TransportStatus = 'disconnected';
  private _statusListeners = new Set<(status: TransportStatus) => void>();
  private _messageListeners = new Set<(msg: A2AMessage) => void>();
  private sentMessages: A2AMessage[] = [];

  get status$(): Subscribable<TransportStatus> {
    const self = this;
    return {
      subscribe(observer: {
        next?: (v: TransportStatus) => void;
        error?: (e: unknown) => void;
        complete?: () => void;
      }): { unsubscribe(): void } {
        const next = observer.next ?? (() => {});
        // Replay current value
        next(self._status);
        const listener = (s: TransportStatus) => next(s);
        self._statusListeners.add(listener);
        return {
          unsubscribe() {
            self._statusListeners.delete(listener);
          },
        };
      },
    };
  }

  get status(): TransportStatus {
    return this._status;
  }

  get messages$(): Subscribable<A2AMessage> {
    const self = this;
    return {
      subscribe(observer: {
        next?: (v: A2AMessage) => void;
        error?: (e: unknown) => void;
        complete?: () => void;
      }): { unsubscribe(): void } {
        const next = observer.next ?? (() => {});
        const listener = (msg: A2AMessage) => next(msg);
        self._messageListeners.add(listener);
        return {
          unsubscribe() {
            self._messageListeners.delete(listener);
          },
        };
      },
    };
  }

  get sentMessagesList(): A2AMessage[] {
    return [...this.sentMessages];
  }

  constructor(options: { agentId: string }) {
    this.agentId = options.agentId;
  }

  async connect(): Promise<void> {
    this._status = 'connecting';
    this._notifyStatus('connecting');
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 10));
    this._status = 'connected';
    this._notifyStatus('connected');
  }

  async disconnect(): Promise<void> {
    this._status = 'disconnected';
    this._notifyStatus('disconnected');
    await Promise.resolve();
  }

  async send(message: A2AMessage): Promise<void> {
    if (this._status !== 'connected') {
      throw new TransportError('Not connected', 'NOT_CONNECTED', false);
    }
    this.sentMessages.push(message);
    await Promise.resolve();
  }

  /**
   * Simulate receiving a message (for testing).
   */
  simulateMessage(message: A2AMessage): void {
    for (const listener of this._messageListeners) {
      listener(message);
    }
  }

  /**
   * Clear sent messages history.
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  destroy(): void {
    this._statusListeners.clear();
    this._messageListeners.clear();
  }

  private _notifyStatus(status: TransportStatus): void {
    for (const listener of this._statusListeners) {
      listener(status);
    }
  }
}

/**
 * Create a mock transport for testing.
 */
export function createMockTransport(agentId: string): MockTransport {
  return new MockTransport({ agentId });
}
