/**
 * A2A Client - High-Level Agent-to-Agent Communication API
 *
 * Provides a simple API for cross-process agent communication.
 * Integrates with Agent Loop via Observable streams.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/09-A2A.md
 */

import {
  Observable,
  Subject,
  BehaviorSubject,
  Subscription,
  of,
} from 'rxjs';
import {
  filter,
  takeUntil,
  take,
  timeout,
  catchError,
  tap,
  mergeMap,
} from 'rxjs/operators';
import { generateId } from '../core/events.js';
import {
  type A2AMessage,
  A2A_BROADCAST_TARGET,
  A2A_PROTOCOL_VERSION,
  A2A_DEFAULT_TTL,
} from './types.js';
import { isMessageExpired } from './message.js';
import {
  type A2ATransport,
  type TransportStatus,
  TransportError,
} from './transport.js';
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
 * to the RxJS error channel.
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

  /** Client events subject */
  private readonly eventsSubject = new Subject<A2AClientEvent | A2AClientErrorEvent>();

  /** Started flag */
  private readonly startedSubject = new BehaviorSubject<boolean>(false);

  /** Destroy signal */
  private readonly destroySubject = new Subject<void>();

  /** Subscription for message handling */
  private messageHandlingSubscription: Subscription | null = null;

  /**
   * Client events observable.
   */
  get events$(): Observable<A2AClientEvent | A2AClientErrorEvent> {
    return this.eventsSubject.asObservable();
  }

  /**
   * Incoming messages observable.
   */
  get messages$(): Observable<A2AMessage> {
    return this.connection.messages$;
  }

  /**
   * Connection status observable.
   */
  get status$(): Observable<TransportStatus> {
    return this.connection.status$;
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
    return this.startedSubject.getValue();
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
    if (this.isStarted) {
      return;
    }

    try {
      await this.connection.connect();
      this.startedSubject.next(true);
      this.emitEvent('a2a.client.started', {});
      this.startMessageHandling();
    } catch (error) {
      this.emitError('START_ERROR', error instanceof Error ? error.message : 'Failed to start client');
      throw error;
    }
  }

  /**
   * Stop the client and disconnect.
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.stopMessageHandling();
    await this.connection.disconnect();
    this.startedSubject.next(false);
    this.emitEvent('a2a.client.stopped', {});
  }

  /**
   * Destroy the client and release all resources.
   */
  destroy(): void {
    this.stopMessageHandling();
    this.connection.destroy();
    this.startedSubject.next(false);
    this.destroySubject.next();
    this.destroySubject.complete();
    this.eventsSubject.complete();
  }

  // ============================================================
  // Request-Response Pattern
  // ============================================================

  /**
   * Send a request and wait for response.
   *
   * Returns an Observable that:
   * - Emits the response message on success
   * - Emits an error message if the remote agent returns an error
   * - Times out if no response is received within timeout
   *
   * Errors are emitted as events, not thrown to RxJS error channel.
   */
  request(
    targetId: string,
    payload: unknown,
    options?: RequestOptions
  ): Observable<A2AMessage> {
    const timeoutMs = options?.timeout ?? this.defaultTimeout;
    const requestId = generateId('req');

    return new Observable<A2AMessage>((subscriber) => {
      this.emitEvent('a2a.client.request_sent', {
        requestId,
        targetId,
        timeout: timeoutMs,
      });

      // Use connection's request method with timeout
      const subscription = this.connection.request(targetId, payload, { timeout: timeoutMs }).pipe(
        takeUntil(this.destroySubject),
        timeout({
          each: timeoutMs,
          with: () => {
            this.emitEvent('a2a.client.timeout', { requestId, targetId });
            return of({
              id: generateId('timeout'),
              from: targetId,
              to: this.agentId,
              timestamp: Date.now(),
              ttl: 0,
              correlationId: requestId,
              type: 'error' as const,
              payload: { code: 'TIMEOUT', message: `Request timed out after ${timeoutMs}ms` },
              version: A2A_PROTOCOL_VERSION,
            } as A2AMessage);
          },
        }),
        catchError((error: Error) => {
          // Convert error to error event/message
          this.emitError('REQUEST_ERROR', error.message, requestId);
          return of({
            id: generateId('err'),
            from: targetId,
            to: this.agentId,
            timestamp: Date.now(),
            ttl: 0,
            correlationId: requestId,
            type: 'error' as const,
            payload: { code: 'REQUEST_ERROR', message: error.message },
            version: A2A_PROTOCOL_VERSION,
          } as A2AMessage);
        }),
        tap((response) => {
          if (response.type === 'response') {
            this.emitEvent('a2a.client.response_received', {
              requestId,
              responseId: response.id,
            });
          } else if (response.type === 'error') {
            this.emitEvent('a2a.client.error_received', {
              requestId,
              error: response.payload,
            });
          }
        })
      ).subscribe(subscriber);

      return () => subscription.unsubscribe();
    });
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
      this.request(targetId, payload, options)
        .pipe(take(1))
        .subscribe({
          next: (response) => {
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
    if (this.isStarted && !this.messageHandlingSubscription) {
      this.startMessageHandling();
    }
  }

  /**
   * Subscribe to messages matching a filter.
   */
  subscribe(
    filterFn: (message: A2AMessage) => boolean = () => true
  ): A2AMessageSubscription {
    const subscription = this.messages$
      .pipe(
        filter(filterFn),
        takeUntil(this.destroySubject)
      )
      .subscribe({
        next: (message) => {
          void this.handleMessageInternal(message);
        },
        error: () => {
          // Never propagate to error channel
        },
      });

    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  }

  /**
   * Subscribe to requests only.
   */
  subscribeRequests(handler: (message: A2AMessage) => Promise<A2AMessage | void>): A2AMessageSubscription {
    const subscription = this.messages$
      .pipe(
        filter((msg) => msg.type === 'request' && msg.to === this.agentId),
        takeUntil(this.destroySubject),
        mergeMap(async (message) => {
          try {
            const result = await handler(message);
            if (result) {
              await this.connection.send(result);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Handler error';
            await this.connection.respondError(message, 'HANDLER_ERROR', errorMessage);
            this.emitError('HANDLER_ERROR', errorMessage, message.id);
          }
        })
      )
      .subscribe({
        error: () => {
          // Never propagate to error channel
        },
      });

    return {
      unsubscribe: () => subscription.unsubscribe(),
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
    if (this.messageHandlingSubscription) {
      return;
    }

    this.messageHandlingSubscription = this.messages$
      .pipe(
        takeUntil(this.destroySubject),
        filter((msg) => msg.to === this.agentId || msg.to === A2A_BROADCAST_TARGET)
      )
      .subscribe({
        next: (message) => {
          void this.handleMessageInternal(message);
        },
        error: () => {
          // Never propagate to error channel
        },
      });
  }

  /**
   * Stop handling incoming messages.
   */
  private stopMessageHandling(): void {
    this.messageHandlingSubscription?.unsubscribe();
    this.messageHandlingSubscription = null;
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
    this.eventsSubject.next({
      type,
      timestamp: Date.now(),
      agentId: this.agentId,
      details,
    });
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
    this.eventsSubject.next({
      type: 'a2a.client.error',
      timestamp: Date.now(),
      agentId: this.agentId,
      error: errorPayload,
    });
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
 */
export class MockTransport implements A2ATransport {
  readonly name = 'mock';
  readonly agentId: string;

  private statusSubject = new BehaviorSubject<TransportStatus>('disconnected');
  private messagesSubject = new Subject<A2AMessage>();
  private sentMessages: A2AMessage[] = [];

  get status$(): Observable<TransportStatus> {
    return this.statusSubject.asObservable();
  }

  get status(): TransportStatus {
    return this.statusSubject.getValue();
  }

  get messages$(): Observable<A2AMessage> {
    return this.messagesSubject.asObservable();
  }

  get sentMessagesList(): A2AMessage[] {
    return [...this.sentMessages];
  }

  constructor(options: { agentId: string }) {
    this.agentId = options.agentId;
  }

  async connect(): Promise<void> {
    this.statusSubject.next('connecting');
    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.statusSubject.next('connected');
  }

  async disconnect(): Promise<void> {
    this.statusSubject.next('disconnected');
    await Promise.resolve();
  }

  async send(message: A2AMessage): Promise<void> {
    if (this.status !== 'connected') {
      throw new TransportError('Not connected', 'NOT_CONNECTED', false);
    }
    this.sentMessages.push(message);
    await Promise.resolve();
  }

  /**
   * Simulate receiving a message (for testing).
   */
  simulateMessage(message: A2AMessage): void {
    this.messagesSubject.next(message);
  }

  /**
   * Clear sent messages history.
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  destroy(): void {
    this.statusSubject.complete();
    this.messagesSubject.complete();
  }
}

/**
 * Create a mock transport for testing.
 */
export function createMockTransport(agentId: string): MockTransport {
  return new MockTransport({ agentId });
}
