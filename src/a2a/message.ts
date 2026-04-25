/**
 * A2A Message Utilities
 *
 * Message construction, parsing, and validation utilities.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/09-A2A.md
 */

import { generateId } from '../core/events.js';
import {
  type A2AMessage,
  type A2AMessageType,
  A2AMessageSchema,
  type A2AErrorPayload,
  A2AErrorPayloadSchema,
  type A2AAckPayload,
  A2AAckPayloadSchema,
  A2A_BROADCAST_TARGET,
  A2A_PROTOCOL_VERSION,
  A2A_DEFAULT_TTL,
} from './types.js';

// ============================================================
// Message Creation
// ============================================================

/**
 * Options for creating an A2A message.
 */
export interface CreateMessageOptions {
  /** Time-to-live in milliseconds */
  ttl?: number;
  /** Correlation ID for request-response pattern */
  correlationId?: string;
  /** Sequence number for ordered messages */
  sequence?: number;
  /** Message signature */
  signature?: string;
  /** Protocol version */
  version?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create an A2A message envelope.
 *
 * @param from - Sender agent ID
 * @param to - Receiver agent ID ('*' for broadcast)
 * @param type - Message type
 * @param payload - Message payload
 * @param options - Additional options
 * @returns Validated A2A message
 */
export function createMessage(
  from: string,
  to: string,
  type: A2AMessageType,
  payload: unknown,
  options: CreateMessageOptions = {}
): A2AMessage {
  const now = Date.now();

  const message: A2AMessage = {
    id: generateId('a2a'),
    from,
    to,
    timestamp: now,
    ttl: options.ttl ?? A2A_DEFAULT_TTL,
    correlationId: options.correlationId,
    sequence: options.sequence,
    signature: options.signature,
    version: options.version ?? A2A_PROTOCOL_VERSION,
    type,
    payload,
    metadata: options.metadata,
  };

  return A2AMessageSchema.parse(message);
}

/**
 * Create a request message.
 *
 * @param from - Sender agent ID
 * @param to - Receiver agent ID
 * @param payload - Request payload
 * @param options - Additional options
 * @returns Request message
 */
export function createRequest(
  from: string,
  to: string,
  payload: unknown,
  options: Omit<CreateMessageOptions, 'correlationId'> = {}
): A2AMessage {
  return createMessage(from, to, 'request', payload, options);
}

/**
 * Create a response message.
 *
 * @param from - Sender agent ID
 * @param to - Receiver agent ID (original sender)
 * @param payload - Response payload
 * @param correlationId - Original request message ID
 * @param options - Additional options
 * @returns Response message
 */
export function createResponse(
  from: string,
  to: string,
  payload: unknown,
  correlationId: string,
  options: Omit<CreateMessageOptions, 'correlationId'> = {}
): A2AMessage {
  return createMessage(from, to, 'response', payload, {
    ...options,
    correlationId,
  });
}

/**
 * Create a notification message (one-way, no response expected).
 *
 * @param from - Sender agent ID
 * @param to - Receiver agent ID ('*' for broadcast)
 * @param payload - Notification payload
 * @param options - Additional options
 * @returns Notification message
 */
export function createNotification(
  from: string,
  to: string,
  payload: unknown,
  options: CreateMessageOptions = {}
): A2AMessage {
  return createMessage(from, to, 'notification', payload, options);
}

/**
 * Create a broadcast message.
 *
 * @param from - Sender agent ID
 * @param payload - Broadcast payload
 * @param options - Additional options
 * @returns Broadcast message
 */
export function createBroadcast(
  from: string,
  payload: unknown,
  options: CreateMessageOptions = {}
): A2AMessage {
  return createNotification(from, A2A_BROADCAST_TARGET, payload, options);
}

/**
 * Create an error message.
 *
 * @param from - Sender agent ID
 * @param to - Original sender ID
 * @param correlationId - Original request message ID
 * @param error - Error payload
 * @param options - Additional options
 * @returns Error message
 */
export function createError(
  from: string,
  to: string,
  correlationId: string,
  error: A2AErrorPayload,
  options: Omit<CreateMessageOptions, 'correlationId'> = {}
): A2AMessage {
  return createMessage(from, to, 'error', error, {
    ...options,
    correlationId,
  });
}

/**
 * Create an acknowledgment message.
 *
 * @param from - Sender agent ID
 * @param to - Original sender ID
 * @param correlationId - Original message ID
 * @param ack - Acknowledgment payload
 * @param options - Additional options
 * @returns Acknowledgment message
 */
export function createAck(
  from: string,
  to: string,
  correlationId: string,
  ack: A2AAckPayload,
  options: Omit<CreateMessageOptions, 'correlationId'> = {}
): A2AMessage {
  return createMessage(from, to, 'ack', ack, {
    ...options,
    correlationId,
  });
}

/**
 * Create a heartbeat message.
 *
 * @param from - Sender agent ID
 * @param to - Receiver agent ID
 * @param options - Additional options
 * @returns Heartbeat message
 */
export function createHeartbeat(
  from: string,
  to: string,
  options: CreateMessageOptions = {}
): A2AMessage {
  return createMessage(from, to, 'heartbeat', { timestamp: Date.now() }, options);
}

// ============================================================
// Message Parsing
// ============================================================

/**
 * Parse result for message parsing.
 */
export interface ParseResult {
  success: boolean;
  message?: A2AMessage;
  error?: string;
}

/**
 * Parse an unknown value as an A2A message.
 *
 * @param raw - Raw input to parse
 * @returns Parse result with message or error
 */
export function parseMessage(raw: unknown): ParseResult {
  const result = A2AMessageSchema.safeParse(raw);

  if (result.success) {
    return { success: true, message: result.data };
  }

  return {
    success: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

/**
 * Parse a JSON string as an A2A message.
 *
 * @param json - JSON string to parse
 * @returns Parse result with message or error
 */
export function parseMessageJson(json: string): ParseResult {
  try {
    const parsed: unknown = JSON.parse(json);
    return parseMessage(parsed);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Invalid JSON',
    };
  }
}

// ============================================================
// Message Validation
// ============================================================

/**
 * Validate that an unknown value is a valid A2A message.
 *
 * @param msg - Value to validate
 * @returns True if valid, false otherwise
 */
export function validateMessage(msg: unknown): boolean {
  return A2AMessageSchema.safeParse(msg).success;
}

/**
 * Validate error payload structure.
 *
 * @param payload - Payload to validate
 * @returns True if valid error payload
 */
export function validateErrorPayload(payload: unknown): boolean {
  return A2AErrorPayloadSchema.safeParse(payload).success;
}

/**
 * Validate acknowledgment payload structure.
 *
 * @param payload - Payload to validate
 * @returns True if valid ack payload
 */
export function validateAckPayload(payload: unknown): boolean {
  return A2AAckPayloadSchema.safeParse(payload).success;
}

/**
 * Check if a message has expired based on TTL.
 *
 * @param message - Message to check
 * @param now - Current timestamp (defaults to Date.now())
 * @returns True if message has expired
 */
export function isMessageExpired(message: A2AMessage, now: number = Date.now()): boolean {
  if (message.ttl === 0) {
    return false; // Never expires
  }
  return message.timestamp + message.ttl < now;
}

// ============================================================
// Message Utilities
// ============================================================

/**
 * Create a correlation ID linking request and response.
 * Uses the request message ID.
 *
 * @param request - Request message
 * @returns Correlation ID
 */
export function createCorrelationId(request: A2AMessage): string {
  return request.id;
}

/**
 * Serialize a message to JSON string.
 *
 * @param message - Message to serialize
 * @returns JSON string
 */
export function serializeMessage(message: A2AMessage): string {
  return JSON.stringify(message);
}
