/**
 * MCP (Model Context Protocol) Subsystem
 *
 * Client implementation for the Model Context Protocol.
 * Provides tool discovery and execution for MCP servers.
 *
 * @example
 * ```typescript
 * import { createMCPClient, adaptMCPTools } from 'agentforge/extensions';
 *
 * const client = createMCPClient({
 *   serverName: 'filesystem',
 *   sessionId: 'session-123',
 * });
 *
 * await client.connect({
 *   type: 'stdio',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 * });
 *
 * const tools = await client.tools();
 * const definitions = adaptMCPTools(tools, client, 'filesystem');
 *
 * const result = await client.callTool('read_file', { path: '/tmp/test.txt' });
 * console.log(result);
 *
 * await client.disconnect();
 * ```
 *
 * @module agentforge/extensions
 */

// ============================================================
// Types
// ============================================================

export {
  // JSON-RPC types
  JSONRPC_VERSION,
  type JSONRPCId,
  type JSONRPCRequest,
  type JSONRPCNotification,
  type JSONRPCErrorObject,
  type JSONRPCSuccessResponse,
  type JSONRPCErrorResponse,
  type JSONRPCResponse,
  type JSONRPCMessage,
  // MCP specific types
  type MCPInitializeParams,
  type MCPInitializeResult,
  type MCPTool as MCPToolSchema,
  type MCPToolsListResult,
  type MCPToolCallParams,
  type MCPContentBlock,
  type MCPToolCallResult,
  // Type guards
  isJSONRPCRequest,
  isJSONRPCNotification,
  isJSONRPCResponse,
  isJSONRPCSuccessResponse,
  isJSONRPCErrorResponse,
  // Helpers
  parseJSONRPCMessage,
  createJSONRPCRequest,
  createJSONRPCNotification,
} from './types.js';

// ============================================================
// Read Buffer
// ============================================================

export { ReadBuffer } from './read-buffer.js';

// ============================================================
// Transport
// ============================================================

export {
  type TransportStatus,
  type MCPTransport,
  type TransportFactory,
  registerTransportFactory,
  createTransport,
  hasTransportFactory,
  getRegisteredTransportTypes,
  // Error types
  MCPTransportError,
  MCPConnectionError,
  MCPSendError,
  MCPParseError,
} from './transport.js';

// ============================================================
// Stdio Transport
// ============================================================

export {
  type StdioTransportConfig,
  StdioTransport,
  createStdioTransport,
} from './stdio-transport.js';

// ============================================================
// HTTP Transport
// ============================================================

export {
  type AuthProvider,
  type ReconnectConfig,
  type HTTPTransportConfig,
  StreamableHTTPTransport,
  createHTTPTransport,
  createSSETransport,
} from './http-transport.js';

// ============================================================
// Client
// ============================================================

export {
  type MCPClientOptions,
  type MCPEventType,
  type MCPEvent,
  AgentForgeMCPClient,
  type CreateMCPClientOptions,
  createMCPClient,
} from './client.js';

// ============================================================
// Tool Adapter
// ============================================================

export {
  adaptMCPTool,
  adaptMCPTools,
  isMCPToolName,
  parseMCPToolName,
  createMCPToolName,
  jsonSchemaToZod,
} from './tool-adapter.js';
