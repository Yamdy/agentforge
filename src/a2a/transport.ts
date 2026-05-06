/**
 * A2A Transport Layer Abstraction
 *
 * Defines the interface for transport implementations.
 * Supports WebSocket, HTTP, and gRPC transports.
 *
 * All subscription APIs use the project's standard callback pattern:
 * `onX(callback) → () => void` — consistent with EventEmitter and HookRegistry.
 */

import type { A2AMessage } from './types.js';
import { type A2ATransportType, A2ATransportTypeSchema } from './types.js';

// ============================================================
// Transport Status
// ============================================================

/**
 * Transport connection status.
 */
export type TransportStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ============================================================
// Transport Configuration
// ============================================================

/**
 * Reconnection configuration.
 */
export interface ReconnectConfig {
  /** Enable automatic reconnection */
  enabled: boolean;
  /** Maximum reconnection attempts */
  maxAttempts: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
}

/**
 * Heartbeat configuration.
 */
export interface HeartbeatConfig {
  /** Enable heartbeat */
  enabled: boolean;
  /** Heartbeat interval in milliseconds */
  interval: number;
  /** Heartbeat timeout in milliseconds */
  timeout: number;
}

/**
 * Backlog/overflow configuration.
 */
export interface BacklogConfig {
  /** Maximum buffer size */
  maxSize: number;
  /** Overflow handling strategy */
  overflowStrategy: 'drop' | 'block' | 'replace';
}

/**
 * Transport configuration options.
 */
export interface A2ATransportOptions {
  /** Agent ID for this transport */
  agentId: string;
  /** Remote endpoint URL */
  endpoint: string;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Reconnection configuration */
  reconnect?: Partial<ReconnectConfig>;
  /** Heartbeat configuration */
  heartbeat?: Partial<HeartbeatConfig>;
  /** Message backlog configuration */
  backlog?: Partial<BacklogConfig>;
  /** Custom headers for HTTP/WebSocket connections */
  headers?: Record<string, string>;
  /** Enable TLS (for secure connections) */
  tls?: boolean;
  /** Debug mode */
  debug?: boolean;
}

/**
 * Default transport configuration values.
 */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  enabled: true,
  maxAttempts: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: true,
  interval: 30000,
  timeout: 10000,
};

export const DEFAULT_BACKLOG_CONFIG: BacklogConfig = {
  maxSize: 1000,
  overflowStrategy: 'drop',
};

// ============================================================
// Transport Interface
// ============================================================

/**
 * A2A Transport interface.
 *
 * Abstracts the underlying communication protocol.
 * Implementations: WebSocket, HTTP, gRPC.
 */
export interface A2ATransport {
  /** Transport name/type */
  readonly name: string;

  /** Current connection status */
  readonly status: TransportStatus;

  /**
   * Register a callback for status changes.
   * Immediately calls callback with the current status on subscribe.
   * Returns an unsubscribe function.
   */
  onStatusChange(callback: (status: TransportStatus) => void): () => void;

  /**
   * Register a callback for incoming messages.
   * Returns an unsubscribe function.
   */
  onMessage(callback: (message: A2AMessage) => void): () => void;

  /** Agent ID for this transport */
  readonly agentId: string;

  /**
   * Establish connection to remote endpoint.
   * @throws Error if connection fails after timeout
   */
  connect(): Promise<void>;

  /**
   * Close connection.
   * Safe to call multiple times.
   */
  disconnect(): Promise<void>;

  /**
   * Send a message through the transport.
   * @param message - Message to send
   * @throws Error if not connected or send fails
   */
  send(message: A2AMessage): Promise<void>;

  /**
   * Clean up resources.
   * Called during shutdown.
   */
  destroy(): void;
}

// ============================================================
// Transport Factory
// ============================================================

/**
 * Transport factory function type.
 */
export type TransportFactory = (options: A2ATransportOptions) => A2ATransport;

/**
 * Registry of transport factories.
 */
const transportFactories = new Map<A2ATransportType, TransportFactory>();

/**
 * Register a transport factory.
 *
 * @param type - Transport type
 * @param factory - Factory function
 */
export function registerTransportFactory(type: A2ATransportType, factory: TransportFactory): void {
  transportFactories.set(type, factory);
}

/**
 * Create a transport instance.
 *
 * @param type - Transport type
 * @param options - Transport options
 * @returns Transport instance
 * @throws Error if transport type is not registered
 */
export function createTransport(
  type: A2ATransportType,
  options: A2ATransportOptions
): A2ATransport {
  // Validate transport type
  const typeResult = A2ATransportTypeSchema.safeParse(type);
  if (!typeResult.success) {
    throw new Error(`Invalid transport type: ${type}`);
  }

  const factory = transportFactories.get(type);
  if (!factory) {
    throw new Error(
      `Transport factory not registered for type: ${type}. ` +
        `Available types: ${Array.from(transportFactories.keys()).join(', ') || 'none'}`
    );
  }

  return factory(options);
}

/**
 * Check if a transport factory is registered.
 *
 * @param type - Transport type
 * @returns True if factory exists
 */
export function hasTransportFactory(type: A2ATransportType): boolean {
  return transportFactories.has(type);
}

/**
 * Get list of registered transport types.
 *
 * @returns Array of transport types
 */
export function getRegisteredTransportTypes(): A2ATransportType[] {
  return Array.from(transportFactories.keys());
}

// ============================================================
// Transport Events
// ============================================================

/**
 * Transport event types for observability.
 */
export type TransportEventType =
  | 'transport.connecting'
  | 'transport.connected'
  | 'transport.disconnected'
  | 'transport.reconnecting'
  | 'transport.error'
  | 'transport.message_sent'
  | 'transport.message_received';

/**
 * Transport event for logging/debugging.
 */
export interface TransportEvent {
  type: TransportEventType;
  timestamp: number;
  transportName: string;
  agentId: string;
  details?: Record<string, unknown>;
}

// ============================================================
// Transport Error Types
// ============================================================

/**
 * Base error class for transport errors.
 */
export class TransportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Connection error (network, timeout, etc.)
 */
export class TransportConnectionError extends TransportError {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message, 'CONNECTION_ERROR', true);
    this.name = 'TransportConnectionError';
  }
}

/**
 * Send error (buffer full, not connected, etc.)
 */
export class TransportSendError extends TransportError {
  constructor(
    message: string,
    public readonly messageData?: Partial<A2AMessage>
  ) {
    super(message, 'SEND_ERROR', false);
    this.name = 'TransportSendError';
  }
}

/**
 * Parse error (invalid message format)
 */
export class TransportParseError extends TransportError {
  constructor(
    message: string,
    public readonly rawData?: unknown
  ) {
    super(message, 'PARSE_ERROR', false);
    this.name = 'TransportParseError';
  }
}
