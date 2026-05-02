/**
 * A2A Message Types - Agent-to-Agent Protocol
 *
 * Core type definitions for cross-process agent communication.
 * Uses Zod schemas for validation at boundaries.
 *
 */

import { z } from 'zod';

// ============================================================
// A2A Message Type Enumeration
// ============================================================

/**
 * A2A message types for different communication patterns.
 */
export const A2AMessageTypeSchema = z.enum([
  'request', // Request expecting response
  'response', // Response to a request
  'notification', // One-way notification
  'error', // Error response
  'heartbeat', // Connection heartbeat
  'ack', // Acknowledgment
]);

export type A2AMessageType = z.infer<typeof A2AMessageTypeSchema>;

// ============================================================
// A2A Role Enumeration
// ============================================================

/**
 * Agent role in A2A communication.
 * Note: A2A is peer-to-peer, but roles help identify message direction.
 */
export const A2ARoleSchema = z.enum(['client', 'server']);

export type A2ARole = z.infer<typeof A2ARoleSchema>;

// ============================================================
// A2A Transport Type Enumeration
// ============================================================

/**
 * Supported transport types for A2A communication.
 */
export const A2ATransportTypeSchema = z.enum(['websocket', 'http', 'grpc']);

export type A2ATransportType = z.infer<typeof A2ATransportTypeSchema>;

// ============================================================
// A2A Message Schema
// ============================================================

/**
 * A2A message envelope schema.
 * All A2A messages must conform to this structure.
 */
export const A2AMessageSchema = z.object({
  // === Routing Information ===
  /** Unique message ID (for idempotency) */
  id: z.string().min(1),

  /** Sender agent ID */
  from: z.string().min(1),

  /** Receiver agent ID ('*' = broadcast) */
  to: z.string().min(1),

  /** Timestamp in milliseconds */
  timestamp: z.number().int().positive(),

  // === Reliability ===
  /** Time-to-live in milliseconds (0 = never expires) */
  ttl: z.number().int().nonnegative().default(0),

  /** Correlation ID for request-response pattern */
  correlationId: z.string().optional(),

  /** Sequence number for ordered messages */
  sequence: z.number().int().nonnegative().optional(),

  // === Security ===
  /** Message signature (optional) */
  signature: z.string().optional(),

  /** Protocol version */
  version: z.string().default('1.0.0'),

  // === Content ===
  /** Message type */
  type: A2AMessageTypeSchema,

  /** Message payload */
  payload: z.unknown(),

  /** Metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type A2AMessage = z.infer<typeof A2AMessageSchema>;

// ============================================================
// Specialized Message Schemas (Discriminated Union)
// ============================================================

/**
 * A2A error payload schema.
 */
export const A2AErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type A2AErrorPayload = z.infer<typeof A2AErrorPayloadSchema>;

/**
 * A2A error message schema (discriminated by type).
 */
export const A2AErrorMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  timestamp: z.number().int().positive(),
  correlationId: z.string(),
  type: z.literal('error'),
  payload: A2AErrorPayloadSchema,
  ttl: z.number().int().nonnegative().default(0),
  version: z.string().default('1.0.0'),
  signature: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type A2AErrorMessage = z.infer<typeof A2AErrorMessageSchema>;

/**
 * A2A acknowledgment payload schema.
 */
export const A2AAckPayloadSchema = z.object({
  originalMessageId: z.string(),
  status: z.enum(['received', 'processing', 'completed', 'failed']),
});

export type A2AAckPayload = z.infer<typeof A2AAckPayloadSchema>;

/**
 * A2A acknowledgment message schema.
 */
export const A2AAckMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  timestamp: z.number().int().positive(),
  correlationId: z.string(),
  type: z.literal('ack'),
  payload: A2AAckPayloadSchema,
  ttl: z.number().int().nonnegative().default(0),
  version: z.string().default('1.0.0'),
  signature: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type A2AAckMessage = z.infer<typeof A2AAckMessageSchema>;

/**
 * Discriminated union of specialized A2A message types.
 */
export const A2ASpecializedMessageSchema = z.discriminatedUnion('type', [
  A2AErrorMessageSchema,
  A2AAckMessageSchema,
]);

export type A2ASpecializedMessage = z.infer<typeof A2ASpecializedMessageSchema>;

// ============================================================
// Type Guards
// ============================================================

/** Check if a value is a valid A2AMessage */
export function isA2AMessage(msg: unknown): msg is A2AMessage {
  return A2AMessageSchema.safeParse(msg).success;
}

/** Check if a message is an error message */
export function isA2AErrorMessage(msg: A2AMessage): msg is A2AErrorMessage {
  return msg.type === 'error';
}

/** Check if a message is an acknowledgment */
export function isA2AAckMessage(msg: A2AMessage): msg is A2AAckMessage {
  return msg.type === 'ack';
}

/** Check if a message is a request (has no correlationId) */
export function isA2ARequest(msg: A2AMessage): boolean {
  return msg.type === 'request' && msg.correlationId === undefined;
}

/** Check if a message is a response */
export function isA2AResponse(msg: A2AMessage): boolean {
  return msg.type === 'response' && msg.correlationId !== undefined;
}

/** Check if a message is a broadcast (to = '*') */
export function isA2ABroadcast(msg: A2AMessage): boolean {
  return msg.to === '*';
}

/** Check if a message is a notification */
export function isA2ANotification(msg: A2AMessage): boolean {
  return msg.type === 'notification';
}

// ============================================================
// Constants
// ============================================================

/** Broadcast target - all agents */
export const A2A_BROADCAST_TARGET = '*';

/** Current A2A protocol version */
export const A2A_PROTOCOL_VERSION = '1.0.0';

/** Default TTL (5 minutes) */
export const A2A_DEFAULT_TTL = 300000;

/** Heartbeat interval (30 seconds) */
export const A2A_HEARTBEAT_INTERVAL = 30000;
