/**
 * A2A Connection Management
 *
 * Manages a single connection with heartbeat, reconnection, and message queue.
 * Uses the transport abstraction for actual communication.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/09-A2A.md
 */

import {
  Observable,
  Subject,
  BehaviorSubject,
  Subscription,
  timer,
  from,
  of,
  EMPTY,
} from 'rxjs';
import {
  takeUntil,
  filter,
  switchMap,
  catchError,
  tap,
} from 'rxjs/operators';
import { generateId } from '../core/events.js';
import {
  type A2AMessage,
  A2A_BROADCAST_TARGET,
} from './types.js';
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
import {
  createHeartbeat,
  createError,
  createResponse,
  isMessageExpired,
} from './message.js';

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
  /** Timeout subscription */
  timeoutSubscription?: Subscription;
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
 * - Errors as events (never throws to RxJS error channel)
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

  /** Connection status subject */
  private readonly statusSubject = new BehaviorSubject<TransportStatus>('disconnected');

  /** Connection events subject */
  private readonly eventsSubject = new Subject<ConnectionEvent | ConnectionErrorEvent>();

  /** Internal message subject for incoming messages */
  private readonly messagesSubject = new Subject<A2AMessage>();

  /** Message queue for outgoing messages */
  private messageQueue: A2AMessage[] = [];

  /** Pending requests awaiting response */
  private pendingRequests = new Map<string, PendingRequest>();

  /** Heartbeat subscription */
  private heartbeatSubscription: Subscription | null = null;

  /** Reconnect subscription */
  private reconnectSubscription: Subscription | null = null;

  /** Transport subscription */
  private transportSubscription: Subscription | null = null;

  /** Destroy signal */
  private readonly destroySubject = new Subject<void>();

  /** Connection attempt count */
  private reconnectAttempts = 0;

  /** Is connection intentionally closed */
  private intentionallyClosed = false;

  /**
   * Connection status observable.
   */
  get status$(): Observable<TransportStatus> {
    return this.statusSubject.asObservable();
  }

  /**
   * Current connection status.
   */
  get status(): TransportStatus {
    return this.statusSubject.getValue();
  }

  /**
   * Connection events observable (for logging/debugging).
   */
  get events$(): Observable<ConnectionEvent | ConnectionErrorEvent> {
    return this.eventsSubject.asObservable();
  }

  /**
   * Incoming messages observable.
   */
  get messages$(): Observable<A2AMessage> {
    return this.messagesSubject.asObservable();
  }

  /**
   * Is connection currently connected.
   */
  get isConnected(): boolean {
    return this.status === 'connected';
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

    // Subscribe to transport status
    this.setupTransportSubscription();
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Open connection.
   */
  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.intentionallyClosed = false;
    this.emitEvent('connection.opening', {});

    try {
      this.statusSubject.next('connecting');
      await this.transport.connect();
      this.statusSubject.next('connected');
      this.reconnectAttempts = 0;
      this.emitEvent('connection.open', {});

      // Start heartbeat
      this.startHeartbeat();

      // Flush queued messages
      this.flushMessageQueue();
    } catch (error) {
      this.emitError('CONNECTION_ERROR', error instanceof Error ? error.message : 'Connection failed', true);

      if (this.reconnectConfig.enabled && !this.intentionallyClosed) {
        this.scheduleReconnect();
      } else {
        this.statusSubject.next('error');
        throw error;
      }
    }
  }

  /**
   * Close connection.
   */
  async disconnect(): Promise<void> {
    if (this.status === 'disconnected') {
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

    this.statusSubject.next('disconnected');
    this.emitEvent('connection.closed', {});
  }

  /**
   * Destroy connection and release all resources.
   */
  destroy(): void {
    this.disconnect().catch(() => {});
    this.stopHeartbeat();
    this.stopReconnect();
    this.cancelAllPendingRequests();

    this.transportSubscription?.unsubscribe();
    this.transportSubscription = null;

    this.destroySubject.next();
    this.destroySubject.complete();

    this.statusSubject.complete();
    this.eventsSubject.complete();
    this.messagesSubject.complete();

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
   * Send a request and wait for response.
   */
  request(
    targetId: string,
    payload: unknown,
    options?: { timeout?: number }
  ): Observable<A2AMessage> {
    const timeoutMs = options?.timeout ?? this.defaultRequestTimeout;
    const correlationId = generateId('req');

    return new Observable<A2AMessage>((subscriber) => {
      const request: A2AMessage = {
        id: correlationId,
        from: this.agentId,
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
        resolve: (msg) => {
          cleanup();
          subscriber.next(msg);
          subscriber.complete();
        },
        reject: (err) => {
          cleanup();
          subscriber.error(err);
        },
      };

      this.pendingRequests.set(correlationId, pending);

      // Setup timeout
      pending.timeoutSubscription = timer(timeoutMs)
        .pipe(takeUntil(this.destroySubject))
        .subscribe(() => {
          this.pendingRequests.delete(correlationId);
          pending.reject(new Error(`Request timeout after ${timeoutMs}ms`));
        });

      // Cleanup function
      const cleanup = (): void => {
        pending.timeoutSubscription?.unsubscribe();
        this.pendingRequests.delete(correlationId);
      };

      // Send request
      this.send(request).catch((error) => {
        cleanup();
        subscriber.error(error);
      });

      return () => {
        cleanup();
      };
    }).pipe(
      // Handle errors as events - convert to error response
      catchError((error: Error) => {
        // Return error as event, not throw
        const errorResponse: A2AMessage = {
          id: generateId('err'),
          from: targetId,
          to: this.agentId,
          timestamp: Date.now(),
          ttl: 0,
          correlationId,
          type: 'error',
          payload: {
            code: 'REQUEST_ERROR',
            message: error.message,
          },
          version: '1.0.0',
        };
        return of(errorResponse);
      })
    );
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
    const response = createResponse(
      this.agentId,
      request.from,
      payload,
      request.id
    );

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

    const errorMessage = createError(
      this.agentId,
      request.from,
      request.id,
      errorPayload
    );

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
      pending.timeoutSubscription?.unsubscribe();
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
  private setupTransportSubscription(): void {
    // Subscribe to transport status
    this.transportSubscription = this.transport.status$
      .pipe(takeUntil(this.destroySubject))
      .subscribe({
        next: (status) => {
          if (status !== this.status) {
            this.statusSubject.next(status);

            if (status === 'connected') {
              this.flushMessageQueue();
            } else if (status === 'error' && this.reconnectConfig.enabled && !this.intentionallyClosed) {
              this.scheduleReconnect();
            }
          }
        },
        error: () => {
          // Never propagate to error channel
        },
      });

    // Subscribe to incoming messages
    this.transport.messages$
      .pipe(takeUntil(this.destroySubject))
      .subscribe({
        next: (message) => {
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
        pending.timeoutSubscription?.unsubscribe();
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

    // Emit to messages stream
    this.messagesSubject.next(message);
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
      this.send(message).catch((error) => {
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

    this.heartbeatSubscription = timer(0, this.heartbeatConfig.interval)
      .pipe(
        takeUntil(this.destroySubject),
        filter(() => this.isConnected),
        switchMap(() => {
          const heartbeat = createHeartbeat(this.agentId, 'server');
          return from(this.transport.send(heartbeat)).pipe(
            tap(() => {
              this.emitEvent('connection.heartbeat_sent', {});
            }),
            catchError(() => {
              this.emitEvent('connection.heartbeat_timeout', {});
              return EMPTY;
            })
          );
        })
      )
      .subscribe({
        error: () => {
          // Never propagate to error channel
        },
      });
  }

  /**
   * Stop heartbeat loop.
   */
  private stopHeartbeat(): void {
    this.heartbeatSubscription?.unsubscribe();
    this.heartbeatSubscription = null;
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
      this.statusSubject.next('error');
      return;
    }

    this.statusSubject.next('reconnecting');
    this.emitEvent('connection.reconnecting', { attempt: this.reconnectAttempts + 1 });

    const delay = Math.min(
      this.reconnectConfig.initialDelay * Math.pow(this.reconnectConfig.backoffMultiplier, this.reconnectAttempts),
      this.reconnectConfig.maxDelay
    );

    this.reconnectAttempts++;

    this.stopReconnect();
    this.reconnectSubscription = timer(delay)
      .pipe(takeUntil(this.destroySubject))
      .subscribe(() => {
        if (!this.intentionallyClosed) {
          this.connect().catch(() => {
            // Will schedule next attempt if needed
          });
        }
      });
  }

  /**
   * Stop reconnect timer.
   */
  private stopReconnect(): void {
    this.reconnectSubscription?.unsubscribe();
    this.reconnectSubscription = null;
  }

  /**
   * Reject all pending requests.
   */
  private rejectAllPendingRequests(reason: string): void {
    for (const pending of this.pendingRequests.values()) {
      pending.timeoutSubscription?.unsubscribe();
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  /**
   * Cancel all pending requests without notification.
   */
  private cancelAllPendingRequests(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.timeoutSubscription?.unsubscribe();
    }
    this.pendingRequests.clear();
  }

  /**
   * Emit a connection event.
   */
  private emitEvent(type: ConnectionEventType, details: Record<string, unknown>): void {
    this.eventsSubject.next({
      type,
      timestamp: Date.now(),
      connectionId: this.connectionId,
      agentId: this.agentId,
      details,
    });
  }

  /**
   * Emit an error event (errors-as-events pattern).
   */
  private emitError(code: string, message: string, recoverable: boolean): void {
    this.eventsSubject.next({
      type: 'connection.error',
      timestamp: Date.now(),
      connectionId: this.connectionId,
      agentId: this.agentId,
      error: { code, message, recoverable },
    });
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
