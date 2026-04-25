/**
 * MCP Transport Interface
 *
 * Abstract transport layer for MCP communication.
 * Implementations: StdioTransport, StreamableHTTPTransport.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import type { JSONRPCMessage } from './types.js';
import type { MCPServerConfig } from '../core/interfaces.js';

// ============================================================
// Transport Status
// ============================================================

/**
 * Transport connection status.
 */
export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ============================================================
// Transport Interface
// ============================================================

/**
 * MCP Transport interface.
 *
 * Abstracts the underlying communication protocol.
 * Follows the pattern from the design doc:
 * - connect(): Establish connection
 * - close(): Graceful shutdown
 * - send(): Send JSON-RPC message
 * - onmessage: Callback for incoming messages
 * - onerror: Callback for errors
 * - onclose: Callback for connection close
 */
export interface MCPTransport {
  /**
   * Establish connection to the server.
   * Must be called before send().
   */
  connect(): Promise<void>;

  /**
   * Close connection gracefully.
   * Safe to call multiple times.
   */
  close(): Promise<void>;

  /**
   * Send a JSON-RPC message to the server.
   * @param message - JSON-RPC message to send
   * @throws Error if not connected
   */
  send(message: JSONRPCMessage): Promise<void>;

  /**
   * Callback for incoming messages.
   * Set by the client to handle responses.
   */
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Callback for transport errors.
   */
  onerror?: (error: Error) => void;

  /**
   * Callback for connection close.
   */
  onclose?: () => void;

  /**
   * Current transport status.
   */
  readonly status: TransportStatus;
}

// ============================================================
// Transport Factory
// ============================================================

/**
 * Transport factory function type.
 */
export type TransportFactory = (config: MCPServerConfig) => MCPTransport;

/**
 * Registry of transport factories.
 */
const transportFactories = new Map<string, TransportFactory>();

/**
 * Register a transport factory.
 *
 * @param type - Transport type ('stdio', 'http', 'sse')
 * @param factory - Factory function
 */
export function registerTransportFactory(type: string, factory: TransportFactory): void {
  transportFactories.set(type, factory);
}

/**
 * Create a transport instance based on config.
 *
 * @param config - MCP server configuration
 * @returns Transport instance
 * @throws Error if transport type is not registered
 */
export function createTransport(config: MCPServerConfig): MCPTransport {
  const factory = transportFactories.get(config.type);
  if (!factory) {
    throw new Error(
      `Transport factory not registered for type: ${config.type}. ` +
        `Available types: ${Array.from(transportFactories.keys()).join(', ') || 'none'}`
    );
  }

  return factory(config);
}

/**
 * Check if a transport factory is registered.
 *
 * @param type - Transport type
 * @returns True if factory exists
 */
export function hasTransportFactory(type: string): boolean {
  return transportFactories.has(type);
}

/**
 * Get list of registered transport types.
 *
 * @returns Array of transport types
 */
export function getRegisteredTransportTypes(): string[] {
  return Array.from(transportFactories.keys());
}

// ============================================================
// Transport Error Types
// ============================================================

/**
 * Base error class for transport errors.
 */
export class MCPTransportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = 'MCPTransportError';
  }
}

/**
 * Connection error (process spawn, network, timeout, etc.)
 */
export class MCPConnectionError extends MCPTransportError {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message, 'CONNECTION_ERROR', true);
    this.name = 'MCPConnectionError';
  }
}

/**
 * Send error (not connected, write failed, etc.)
 */
export class MCPSendError extends MCPTransportError {
  constructor(message: string) {
    super(message, 'SEND_ERROR', false);
    this.name = 'MCPSendError';
  }
}

/**
 * Parse error (invalid JSON-RPC message)
 */
export class MCPParseError extends MCPTransportError {
  constructor(
    message: string,
    public readonly rawData?: unknown
  ) {
    super(message, 'PARSE_ERROR', false);
    this.name = 'MCPParseError';
  }
}
