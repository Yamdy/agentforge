/**
 * MCP JSON-RPC Types
 *
 * Zod schemas for JSON-RPC 2.0 messages used by MCP.
 * All external data from MCP servers is validated with these schemas.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { z } from 'zod';

// ============================================================
// JSON-RPC 2.0 Base Schemas
// ============================================================

/**
 * JSON-RPC version literal
 */
export const JSONRPC_VERSION = '2.0';

/**
 * JSON-RPC request ID type (string or number)
 */
export const JSONRPCIdSchema = z.union([z.string(), z.number()]);
export type JSONRPCId = z.infer<typeof JSONRPCIdSchema>;

// ============================================================
// JSON-RPC Request
// ============================================================

/**
 * JSON-RPC Request Schema
 */
export const JSONRPCRequestSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JSONRPCIdSchema,
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;

// ============================================================
// JSON-RPC Notification
// ============================================================

/**
 * JSON-RPC Notification Schema (no id, no response expected)
 */
export const JSONRPCNotificationSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;

// ============================================================
// JSON-RPC Response
// ============================================================

/**
 * JSON-RPC Error Object Schema
 */
export const JSONRPCErrorObjectSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

export type JSONRPCErrorObject = z.infer<typeof JSONRPCErrorObjectSchema>;

/**
 * JSON-RPC Success Response Schema
 */
export const JSONRPCSuccessResponseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JSONRPCIdSchema,
  result: z.unknown(),
});

export type JSONRPCSuccessResponse = z.infer<typeof JSONRPCSuccessResponseSchema>;

/**
 * JSON-RPC Error Response Schema
 */
export const JSONRPCErrorResponseSchema = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JSONRPCIdSchema,
  error: JSONRPCErrorObjectSchema,
});

export type JSONRPCErrorResponse = z.infer<typeof JSONRPCErrorResponseSchema>;

/**
 * JSON-RPC Response (success or error)
 */
export const JSONRPCResponseSchema = z.union([
  JSONRPCSuccessResponseSchema,
  JSONRPCErrorResponseSchema,
]);

export type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;

// ============================================================
// JSON-RPC Message Union
// ============================================================

/**
 * JSON-RPC Message (any type)
 */
export const JSONRPCMessageSchema = z.union([
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCResponseSchema,
]);

export type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;

// ============================================================
// Type Guards
// ============================================================

/**
 * Check if message is a JSON-RPC Request
 */
export function isJSONRPCRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return 'id' in message && 'method' in message;
}

/**
 * Check if message is a JSON-RPC Notification
 */
export function isJSONRPCNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return !('id' in message) && 'method' in message;
}

/**
 * Check if message is a JSON-RPC Response
 */
export function isJSONRPCResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return 'id' in message && !('method' in message);
}

/**
 * Check if response is a success response
 */
export function isJSONRPCSuccessResponse(
  response: JSONRPCResponse
): response is JSONRPCSuccessResponse {
  return 'result' in response;
}

/**
 * Check if response is an error response
 */
export function isJSONRPCErrorResponse(
  response: JSONRPCResponse
): response is JSONRPCErrorResponse {
  return 'error' in response;
}

// ============================================================
// MCP Protocol Specific Types
// ============================================================

/**
 * MCP Initialize Request Params
 */
export const MCPInitializeParamsSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
  clientInfo: z.object({
    name: z.string(),
    version: z.string(),
  }),
});

export type MCPInitializeParams = z.infer<typeof MCPInitializeParamsSchema>;

/**
 * MCP Initialize Response Result
 */
export const MCPInitializeResultSchema = z.object({
  protocolVersion: z.string(),
  capabilities: z.record(z.string(), z.unknown()),
  serverInfo: z.object({
    name: z.string(),
    version: z.string(),
  }),
});

export type MCPInitializeResult = z.infer<typeof MCPInitializeResultSchema>;

/**
 * MCP Tool Definition
 */
export const MCPToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});

export type MCPTool = z.infer<typeof MCPToolSchema>;

/**
 * MCP Tools List Response
 */
export const MCPToolsListResultSchema = z.object({
  tools: z.array(MCPToolSchema),
});

export type MCPToolsListResult = z.infer<typeof MCPToolsListResultSchema>;

/**
 * MCP Tool Call Params
 */
export const MCPToolCallParamsSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export type MCPToolCallParams = z.infer<typeof MCPToolCallParamsSchema>;

/**
 * MCP Content Block
 */
export const MCPContentBlockSchema = z.object({
  type: z.enum(['text', 'image', 'resource']),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
});

export type MCPContentBlock = z.infer<typeof MCPContentBlockSchema>;

/**
 * MCP Tool Call Result
 */
export const MCPToolCallResultSchema = z.object({
  content: z.array(MCPContentBlockSchema),
  isError: z.boolean().optional(),
});

export type MCPToolCallResult = z.infer<typeof MCPToolCallResultSchema>;

// ============================================================
// Validation Helpers
// ============================================================

/**
 * Validate JSON-RPC message with graceful degradation
 */
export function parseJSONRPCMessage(raw: unknown): JSONRPCMessage | null {
  const result = JSONRPCMessageSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  return null;
}

/**
 * Create a JSON-RPC request
 */
export function createJSONRPCRequest(
  id: JSONRPCId,
  method: string,
  params?: Record<string, unknown>
): JSONRPCRequest {
  const request: JSONRPCRequest = {
    jsonrpc: JSONRPC_VERSION,
    id,
    method,
  };
  if (params !== undefined) {
    request.params = params;
  }
  return request;
}

/**
 * Create a JSON-RPC notification
 */
export function createJSONRPCNotification(
  method: string,
  params?: Record<string, unknown>
): JSONRPCNotification {
  const notification: JSONRPCNotification = {
    jsonrpc: JSONRPC_VERSION,
    method,
  };
  if (params !== undefined) {
    notification.params = params;
  }
  return notification;
}
