/**
 * A2A Module - Agent-to-Agent Protocol
 *
 * Public API for cross-process agent communication.
 *
 * @module
 */

// ============================================================
// Types
// ============================================================

export {
  // Enums
  A2AMessageTypeSchema,
  type A2AMessageType,
  A2ARoleSchema,
  type A2ARole,
  A2ATransportTypeSchema,
  type A2ATransportType,
  // Message Schema
  A2AMessageSchema,
  type A2AMessage,
  // Specialized Schemas
  A2AErrorPayloadSchema,
  type A2AErrorPayload,
  A2AErrorMessageSchema,
  type A2AErrorMessage,
  A2AAckPayloadSchema,
  type A2AAckPayload,
  A2AAckMessageSchema,
  type A2AAckMessage,
  A2ASpecializedMessageSchema,
  type A2ASpecializedMessage,
  // Type Guards
  isA2AMessage,
  isA2AErrorMessage,
  isA2AAckMessage,
  isA2ARequest,
  isA2AResponse,
  isA2ABroadcast,
  isA2ANotification,
  // Constants
  A2A_BROADCAST_TARGET,
  A2A_PROTOCOL_VERSION,
  A2A_DEFAULT_TTL,
  A2A_HEARTBEAT_INTERVAL,
} from './types.js';

// ============================================================
// Message Utilities
// ============================================================

export {
  // Creation
  type CreateMessageOptions,
  createMessage,
  createRequest,
  createResponse,
  createNotification,
  createBroadcast,
  createError,
  createAck,
  createHeartbeat,
  // Parsing
  type ParseResult,
  parseMessage,
  parseMessageJson,
  // Validation
  validateMessage,
  validateErrorPayload,
  validateAckPayload,
  isMessageExpired,
  // Utilities
  createCorrelationId,
  serializeMessage,
} from './message.js';

// ============================================================
// Transport
// ============================================================

export {
  // Status
  type TransportStatus,
  // Configuration
  type ReconnectConfig,
  type HeartbeatConfig,
  type BacklogConfig,
  type A2ATransportOptions,
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_BACKLOG_CONFIG,
  // Interface
  type A2ATransport,
  type TransportFactory,
  // Factory
  registerTransportFactory,
  createTransport,
  hasTransportFactory,
  getRegisteredTransportTypes,
  // Events
  type TransportEventType,
  type TransportEvent,
  // Errors
  TransportError,
  TransportConnectionError,
  TransportSendError,
  TransportParseError,
} from './transport.js';

// ============================================================
// Connection
// ============================================================

export {
  // Events
  type ConnectionEventType,
  type ConnectionEvent,
  type ConnectionErrorEvent,
  // Configuration
  type A2AConnectionOptions,
  // Class
  A2AConnection,
  // Factory
  createConnection,
} from './connection.js';

// ============================================================
// Transport Implementations
// ============================================================

export { HTTPTransport } from './http-transport.js';
export { WebSocketTransport } from './ws-transport.js';

// ============================================================
// Client
// ============================================================

export {
  // Events
  type A2AClientEventType,
  type A2AClientEvent,
  type A2AClientErrorEvent,
  // Options
  type RequestOptions,
  type NotifyOptions,
  // Handler
  type A2AMessageHandler,
  type A2AMessageSubscription,
  // Configuration
  type A2AClientOptions,
  // Class
  A2AClient,
  // Factory
  createClient,
  // Mock (for testing)
  MockTransport,
  createMockTransport,
} from './client.js';
