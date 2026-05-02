/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * A2A Connection Management
 *
 * Manages a single connection with heartbeat, reconnection, and message queue.
 * Uses the transport abstraction for actual communication.
 * Callback-based API
 *
 */

import { generateId } from '../core/events.js';
import { type A2AMessage, A2A_BROADCAST_TARGET } from './types.js';
import {
  type A2ATransport,
  type TransportStatus,
  type ReconnectConfig,
  type HeartbeatConfig,
  type BacklogConfig,
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_BACKLOG_CONFIG,
  TransportError,
} from './transport.js';
import type { Subscribable } from './transport.js';
import { createHeartbeat, createError, createResponse, isMessageExpired } from './message.js';

// ============================================================
// Connection Events
// ============================================================

/**
 * Connection event types for observability.
 */
export type ConnectionEventType =
  | 'connection.opening'
  | 'connection.open'
  | 'connection.closing'
  | 'connection.closed'
  | 'connection.error'
  | 'connection.reconnecting'
  | 'connection.heartbeat_sent'
  | 'connection.heartbeat_timeout'
  | 'connection.message_queued'
  | 'connection.message_sent';

/**
 * Connection event for logging/debugging.
 */
export interface ConnectionEvent {
  type: ConnectionEventType;
  timestamp: number;
  connectionId: string;
  agentId: string;
  details?: Record<string, unknown>;
}

/**
 * Connection error event (errors-as-events pattern).
 */
export interface ConnectionErrorEvent {
  type: 'connection.error';
  timestamp: number;
  connectionId: string;
  agentId: string;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

// ============================================================
// Pending Request Tracking
// ============================================================

/**
 * Tracks a pending request awaiting response.
 */
interface PendingRequest {
  /** Request message ID */
  requestId: string;
  /** Correlation ID */
  correlationId: string;
  /** Target agent ID */
  targetId: string;
  /** Timestamp when request was sent */
  sentAt: number;
  /** Timeout duration in ms */
  timeout: number;
  /** Resolver for response promise */
  resolve: (message: A2AMessage) => void;
  /** Rejecter for timeout/error */
  reject: (error: Error) => void;
  /** Timeout timer */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

// ============================================================
// Connection Configuration
// ============================================================

/**
 * A2A Connection configuration options.
 */
export interface A2AConnectionOptions {
  /** Transport instance to use */
  transport: A2ATransport;
  /** Agent ID for this connection */
  agentId: string;
  /** Heartbeat configuration */
  heartbeat?: Partial<HeartbeatConfig>;
  /** Reconnection configuration */
  reconnect?: Partial<ReconnectConfig>;
  /** Message backlog configuration */
  backlog?: Partial<BacklogConfig>;
  /** Default request timeout in ms */
  requestTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// ============================================================
// A2A Connection Class
// ============================================================

/**
 * A2A Connection - Manages a single connection with reliability features.
 *
 * Features:
 * - Heartbeat maintenance
 * - Automatic reconnection
 * - Message queue with backlog handling
 * - Request-response correlation
 * - Errors as events (never throws to error channel)
 *
 * Callback-based API:
 * - onStatus(fn) replaces status$ observable
 * - onEvent(fn) replaces events$ observable
 * - onMessage(fn) replaces messages$ observable
 */
export class A2AConnection {
  /** Unique connection ID */
  readonly connectionId: string;

  /** Agent ID for this connection */
  readonly agentId: string;

  /** Transport instance */
  private readonly transport: A2ATransport;

  /** Heartbeat configuration */
  private readonly heartbeatConfig: HeartbeatConfig;

  /** Reconnection configuration */
  private readonly reconnectConfig: ReconnectConfig;

  /** Backlog configuration */
  private readonly backlogConfig: BacklogConfig;

  /** Default request timeout */
  private readonly defaultRequestTimeout: number;

  /** Debug mode */
  private readonly debug: boolean;

  /** Current status value */
  private _status: TransportStatus = 'disconnected';

  /** Status listeners (replays current value on subscribe) */
  private readonly _statusListeners = new Set<(status: TransportStatus) => void>();

  /** Event listeners */
  private readonly _eventListeners = new Set<
    (event: ConnectionEvent | ConnectionErrorEvent) => void
  >();

  /** Message listeners */
  private readonly _messageListeners = new Set<(msg: A2AMessage) => void>();

  /** Message queue for outgoing messages */
  private messageQueue: A2AMessage[] = [];

  /** Pending requests awaiting response */
  private pendingRequests = new Map<string, PendingRequest>();

  /** Heartbeat interval timer */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Reconnect timeout timer */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Transport status subscription cleanup */
  private transportStatusUnsub: { unsubscribe(): void } | null = null;

  /** Transport message subscription cleanup */
  private transportMessageUnsub: { unsubscribe(): void } | null = null;

  /** Stopped flag (for takeUntil replacement) */
  private _stopped = false;

  /** Connection attempt count */
  private reconnectAttempts = 0;

  /** Is connection intentionally closed */
  private intentionallyClosed = false;

  // ============================================================
  // Public API - Callback-based Subscriptions
  // ============================================================

  /**
   * Register a callback for status changes.
   * Immediately calls the callback with current status (replay-on-subscribe).
   * Returns an unsubscribe function.
   */
  onStatus(callback: (status: TransportStatus) => void): () => void {
    // Replay current value immediately
    callback(this._status);
    this._statusListeners.add(callback);
    return () => {
      this._statusListeners.delete(callback);
    };
  }

  /**
   * Register a callback for connection events (logging/debugging).
   * Returns an unsubscribe function.
   */
  onEvent(callback: (event: ConnectionEvent | ConnectionErrorEvent) => void): () => void {
    this._eventListeners.add(callback);
    return () => {
      this._eventListeners.delete(callback);
    };
  }

  /**
   * Register a callback for incoming messages.
   * Returns an unsubscribe function.
   */
  onMessage(callback: (msg: A2AMessage) => void): () => void {
    this._messageListeners.add(callback);
    return () => {
      this._messageListeners.delete(callback);
    };
  }

  /**
   * Current connection status.
   */
  get status(): TransportStatus {
    return this._status;
  }

  /**
   * Is connection currently connected.
   */
  get isConnected(): boolean {
    return this._status === 'connected';
  }

  constructor(options: A2AConnectionOptions) {
    this.connectionId = generateId('conn');
    this.agentId = options.agentId;
    this.transport = options.transport;

    this.heartbeatConfig = {
      ...DEFAULT_HEARTBEAT_CONFIG,
      ...options.heartbeat,
    };

    this.reconnectConfig = {
      ...DEFAULT_RECONNECT_CONFIG,
      ...options.reconnect,
    };

    this.backlogConfig = {
      ...DEFAULT_BACKLOG_CONFIG,
      ...options.backlog,
    };

    this.defaultRequestTimeout = options.requestTimeout ?? 30000;
    this.debug = options.debug ?? false;

    // Subscribe to transport status and messages
    this.setupTransportSubscriptions();
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Open connection.
   */
  async connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') {
      return;
    }

    this.intentionallyClosed = false;
    this.emitEvent('connection.opening', {});

    try {
      this.setStatus('connecting');
      await this.transport.connect();
      this.setStatus('connected');
      this.reconnectAttempts = 0;
      this.emitEvent('connection.open', {});

      // Start heartbeat
      this.startHeartbeat();

      // Flush queued messages
      this.flushMessageQueue();
    } catch (error) {
      this.emitError(
        'CONNECTION_ERROR',
        error instanceof Error ? error.message : 'Connection failed',
        true
      );

      if (this.reconnectConfig.enabled && !this.intentionallyClosed) {
        this.scheduleReconnect();
      } else {
        this.setStatus('error');
        throw error;
      }
    }
  }

  /**
   * Close connection.
   */
  async disconnect(): Promise<void> {
    if (this._status === 'disconnected') {
      return;
    }

    this.intentionallyClosed = true;
    this.emitEvent('connection.closing', {});

    // Stop heartbeat
    this.stopHeartbeat();

    // Cancel reconnect
    this.stopReconnect();

    // Reject all pending requests
    this.rejectAllPendingRequests('Connection closed');

    try {
      await this.transport.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.setStatus('disconnected');
    this.emitEvent('connection.closed', {});
  }

  /**
   * Destroy connection and release all resources.
   */
  destroy(): void {
    // Mark stopped first to prevent any new timers/callbacks
    this._stopped = true;

    // Disconnect async (fire and forget)
    this.disconnect().catch(() => {});

    this.stopHeartbeat();
    this.stopReconnect();
    this.cancelAllPendingRequests();

    // Unsubscribe from transport
    this.transportStatusUnsub?.unsubscribe();
    this.transportStatusUnsub = null;
    this.transportMessageUnsub?.unsubscribe();
    this.transportMessageUnsub = null;

    // Clear all listeners
    this._statusListeners.clear();
    this._eventListeners.clear();
    this._messageListeners.clear();

    this.transport.destroy();
  }

  // ============================================================
  // Message Sending
  // ============================================================

  /**
   * Send a message through the connection.
   * Queues message if not connected.
   */
  async send(message: A2AMessage): Promise<void> {
    if (!this.isConnected) {
      // Queue message for later
      this.queueMessage(message);
      return;
    }

    try {
      await this.transport.send(message);
      this.emitEvent('connection.message_sent', { messageId: message.id });
    } catch (error) {
      // Queue on failure for retry
      this.queueMessage(message);

      const errorMessage = error instanceof Error ? error.message : 'Send failed';
      this.emitError('SEND_ERROR', errorMessage, false);

      throw error;
    }
  }

  /**
   * Send a request and subscribe to the response.
   * Returns a Subscribable for callback-based consumption.
   */
  request(
    targetId: string,
    payload: unknown,
    options?: { timeout?: number }
  ): Subscribable<A2AMessage> {
    const timeoutMs = options?.timeout ?? this.defaultRequestTimeout;
    const correlationId = generateId('req');

    const self = this;

    return {
      subscribe(observer: {
        next?: (v: A2AMessage) => void;
        error?: (e: Error) => void;
        complete?: () => void;
      }): { unsubscribe(): void } {
        const next = observer.next ?? (() => {});
        const error = observer.error ?? (() => {});
        const complete = observer.complete ?? (() => {});
        let settled = false;

        const request: A2AMessage = {
          id: correlationId,
          from: self.agentId,
          to: targetId,
          timestamp: Date.now(),
          ttl: timeoutMs,
          type: 'request',
          payload,
          version: '1.0.0',
        };

        // Track pending request
        const pending: PendingRequest = {
          requestId: correlationId,
          correlationId,
          targetId,
          sentAt: Date.now(),
          timeout: timeoutMs,
          resolve: msg => {
            if (settled) return;
            settled = true;
            cleanup();
            next(msg);
            complete();
          },
          reject: err => {
            if (settled) return;
            settled = true;
            cleanup();
            // Errors-as-events: convert to error message
            const errorResponse: A2AMessage = {
              id: generateId('err'),
              from: targetId,
              to: self.agentId,
              timestamp: Date.now(),
              ttl: 0,
              correlationId,
              type: 'error',
              payload: {
                code: 'REQUEST_ERROR',
                message: err.message,
              },
              version: '1.0.0',
            };
            next(errorResponse);
            complete();
          },
          timeoutTimer: null,
        };

        self.pendingRequests.set(correlationId, pending);

        // Setup timeout
        pending.timeoutTimer = setTimeout(() => {
          if (!self._stopped) {
            self.pendingRequests.delete(correlationId);
            pending.reject(new Error(`Request timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        // Cleanup function
        const cleanup = (): void => {
          if (pending.timeoutTimer !== null) {
            clearTimeout(pending.timeoutTimer);
          }
          self.pendingRequests.delete(correlationId);
        };

        // Send request
        self.send(request).catch(err => {
          if (!settled) {
            settled = true;
            cleanup();
            error(err);
          }
        });

        return {
          unsubscribe() {
            cleanup();
          },
        };
      },
    };
  }

  /**
   * Send a notification (one-way, no response expected).
   */
  async notify(targetId: string, payload: unknown): Promise<void> {
    const message: A2AMessage = {
      id: generateId('notify'),
      from: this.agentId,
      to: targetId,
      timestamp: Date.now(),
      ttl: 0,
      type: 'notification',
      payload,
      version: '1.0.0',
    };

    return this.send(message);
  }

  /**
   * Send a broadcast message to all agents.
   */
  async broadcast(payload: unknown): Promise<void> {
    const message: A2AMessage = {
      id: generateId('broadcast'),
      from: this.agentId,
      to: A2A_BROADCAST_TARGET,
      timestamp: Date.now(),
      ttl: 0,
      type: 'notification',
      payload,
      version: '1.0.0',
    };

    return this.send(message);
  }

  /**
   * Send a response to a request.
   */
  async respond(request: A2AMessage, payload: unknown): Promise<void> {
    const response = createResponse(this.agentId, request.from, payload, request.id);

    return this.send(response);
  }

  /**
   * Send an error response.
   */
  async respondError(
    request: A2AMessage,
    code: string,
    message: string,
    details?: unknown
  ): Promise<void> {
    const errorPayload = {
      code,
      message,
      details,
    };

    const errorMessage = createError(this.agentId, request.from, request.id, errorPayload);

    return this.send(errorMessage);
  }

  // ============================================================
  // Pending Request Management
  // ============================================================

  /**
   * Get all pending request IDs.
   */
  getPendingRequestIds(): string[] {
    return Array.from(this.pendingRequests.keys());
  }

  /**
   * Check if a request is pending.
   */
  hasPendingRequest(correlationId: string): boolean {
    return this.pendingRequests.has(correlationId);
  }

  /**
   * Cancel a pending request.
   */
  cancelRequest(correlationId: string): boolean {
    const pending = this.pendingRequests.get(correlationId);
    if (pending) {
      if (pending.timeoutTimer !== null) {
        clearTimeout(pending.timeoutTimer);
      }
      pending.reject(new Error('Request cancelled'));
      this.pendingRequests.delete(correlationId);
      return true;
    }
    return false;
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Setup transport subscriptions.
   */
  private setupTransportSubscriptions(): void {
    // Subscribe to transport status
    this.transportStatusUnsub = this.transport.status$.subscribe({
      next: (status: TransportStatus) => {
        if (this._stopped) return;
        if (status !== this._status) {
          this.setStatus(status);

          if (status === 'connected') {
            this.flushMessageQueue();
          } else if (
            status === 'error' &&
            this.reconnectConfig.enabled &&
            !this.intentionallyClosed
          ) {
            this.scheduleReconnect();
          }
        }
      },
      error: () => {
        // Never propagate to error channel
      },
    });

    // Subscribe to incoming messages
    this.transportMessageUnsub = this.transport.messages$.subscribe({
      next: (message: A2AMessage) => {
        if (this._stopped) return;
        this.handleIncomingMessage(message);
      },
      error: () => {
        // Never propagate to error channel
      },
    });
  }

  /**
   * Handle incoming message.
   */
  private handleIncomingMessage(message: A2AMessage): void {
    // Check expiration
    if (isMessageExpired(message)) {
      this.debugLog('Ignoring expired message:', message.id);
      return;
    }

    // Handle heartbeat
    if (message.type === 'heartbeat') {
      // Heartbeat received, connection is alive
      return;
    }

    // Handle response to pending request
    if (message.correlationId && (message.type === 'response' || message.type === 'error')) {
      const pending = this.pendingRequests.get(message.correlationId);
      if (pending) {
        if (pending.timeoutTimer !== null) {
          clearTimeout(pending.timeoutTimer);
        }
        this.pendingRequests.delete(message.correlationId);

        if (message.type === 'error') {
          const errorPayload = message.payload as { code?: string; message?: string };
          pending.reject(new Error(errorPayload.message ?? 'Request failed'));
        } else {
          pending.resolve(message);
        }
        return;
      }
    }

    // Emit to message listeners
    for (const listener of this._messageListeners) {
      listener(message);
    }
  }

  /**
   * Queue a message for later delivery.
   */
  private queueMessage(message: A2AMessage): void {
    if (this.messageQueue.length >= this.backlogConfig.maxSize) {
      switch (this.backlogConfig.overflowStrategy) {
        case 'drop':
          this.emitEvent('connection.message_queued', {
            messageId: message.id,
            dropped: true,
          });
          return;

        case 'replace':
          this.messageQueue.shift();
          break;

        case 'block':
          throw new TransportError('Message queue full', 'QUEUE_FULL', false);

        default:
          break;
      }
    }

    this.messageQueue.push(message);
    this.emitEvent('connection.message_queued', { messageId: message.id });
  }

  /**
   * Flush queued messages.
   */
  private flushMessageQueue(): void {
    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const message of queue) {
      this.send(message).catch(error => {
        this.debugLog('Failed to flush message:', message.id, error);
        // Re-queue on failure if not overflow
        if (this.messageQueue.length < this.backlogConfig.maxSize) {
          this.messageQueue.push(message);
        }
      });
    }
  }

  /**
   * Start heartbeat loop.
   */
  private startHeartbeat(): void {
    if (!this.heartbeatConfig.enabled) {
      return;
    }

    this.stopHeartbeat();

    const sendHeartbeat = async (): Promise<void> => {
      if (this._stopped || !this.isConnected) return;

      const heartbeat = createHeartbeat(this.agentId, 'server');
      try {
        await this.transport.send(heartbeat);
        this.emitEvent('connection.heartbeat_sent', {});
      } catch {
        this.emitEvent('connection.heartbeat_timeout', {});
      }
    };

    // Immediate first heartbeat, then interval
    void sendHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void sendHeartbeat();
    }, this.heartbeatConfig.interval);
  }

  /**
   * Stop heartbeat loop.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      this.emitError(
        'RECONNECT_EXHAUSTED',
        `Max reconnection attempts (${this.reconnectConfig.maxAttempts}) reached`,
        false
      );
      this.setStatus('error');
      return;
    }

    this.setStatus('reconnecting');
    this.emitEvent('connection.reconnecting', { attempt: this.reconnectAttempts + 1 });

    const delay = Math.min(
      this.reconnectConfig.initialDelay *
        Math.pow(this.reconnectConfig.backoffMultiplier, this.reconnectAttempts),
      this.reconnectConfig.maxDelay
    );

    this.reconnectAttempts++;

    this.stopReconnect();
    this.reconnectTimer = setTimeout(() => {
      if (this._stopped) return;
      if (!this.intentionallyClosed) {
        this.connect().catch(() => {
          // Will schedule next attempt if needed
        });
      }
    }, delay);
  }

  /**
   * Stop reconnect timer.
   */
  private stopReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Reject all pending requests.
   */
  private rejectAllPendingRequests(reason: string): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.timeoutTimer !== null) {
        clearTimeout(pending.timeoutTimer);
      }
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /**
   * Cancel all pending requests without notification.
   */
  private cancelAllPendingRequests(): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.timeoutTimer !== null) {
        clearTimeout(pending.timeoutTimer);
      }
    }
    this.pendingRequests.clear();
  }

  /**
   * Set status and notify listeners.
   */
  private setStatus(status: TransportStatus): void {
    this._status = status;
    for (const listener of this._statusListeners) {
      listener(status);
    }
  }

  /**
   * Emit a connection event.
   */
  private emitEvent(type: ConnectionEventType, details: Record<string, unknown>): void {
    const event: ConnectionEvent = {
      type,
      timestamp: Date.now(),
      connectionId: this.connectionId,
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
  private emitError(code: string, message: string, recoverable: boolean): void {
    const errorEvent: ConnectionErrorEvent = {
      type: 'connection.error',
      timestamp: Date.now(),
      connectionId: this.connectionId,
      agentId: this.agentId,
      error: { code, message, recoverable },
    };
    for (const listener of this._eventListeners) {
      listener(errorEvent);
    }
  }

  /**
   * Debug logging.
   */
  private debugLog(...args: unknown[]): void {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(`[A2AConnection ${this.connectionId}]`, ...args);
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create an A2A connection with the given transport.
 */
export function createConnection(options: A2AConnectionOptions): A2AConnection {
  return new A2AConnection(options);
}
