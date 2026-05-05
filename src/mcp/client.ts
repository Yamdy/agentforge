/**
 * AgentForge MCP Client Implementation
 *
 * Implements the MCPClient interface from core/interfaces.ts.
 * Follows MCP specification 2025-11-25.
 *
 *
 */

import type { MCPClient, MCPServerConfig, MCPStatus } from '../core/interfaces.js';
import type { SerializedError } from '../core/events.js';
import { validateMCPResponse, type MCPToolResponse } from '../contracts/mcp-contract.js';
import type { MCPTransport } from './transport.js';
import { createTransport, registerTransportFactory } from './transport.js';
import { createStdioTransport } from './stdio-transport.js';
import { createHTTPTransport, createSSETransport } from './http-transport.js';
import type { JSONRPCId } from './types.js';
import {
  createJSONRPCRequest,
  createJSONRPCNotification,
  isJSONRPCResponse,
  isJSONRPCSuccessResponse,
} from './types.js';

// ============================================================
// MCP Client Options
// ============================================================

/**
 * MCP client configuration options.
 */
export interface MCPClientOptions {
  /** Tool call timeout in milliseconds */
  timeout?: number;
  /** Enable automatic reconnection */
  autoReconnect?: boolean;
  /** Server name for event identification */
  serverName: string;
  /** Session ID for event correlation */
  sessionId: string;
  /** Event emitter for MCP lifecycle events */
  emitEvent?: (event: MCPEvent) => void;
}

/**
 * MCP lifecycle event types.
 */
export type MCPEventType =
  | 'mcp.connecting'
  | 'mcp.connected'
  | 'mcp.disconnected'
  | 'mcp.tools_changed'
  | 'mcp.error';

/**
 * MCP event structure.
 */
export interface MCPEvent {
  type: MCPEventType;
  timestamp: number;
  sessionId: string;
  serverName: string;
  [key: string]: unknown;
}

// ============================================================
// AgentForge MCP Client
// ============================================================

/**
 * Pending request tracker.
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * AgentForge MCP Client implementation.
 *
 * Follows MCP specification:
 * 1. Initialize handshake - capabilities negotiation
 * 2. Tool discovery - tools/list
 * 3. Tool calling - tools/call
 * 4. Error handling - errors in result.isError, never throws
 *
 * Usage:
 * ```typescript
 * const client = new AgentForgeMCPClient(
 *   { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
 *   { serverName: 'filesystem', sessionId: 'session-123' }
 * );
 *
 * await client.connect();
 * const tools = await client.tools();
 * const result = await client.callTool('read_file', { path: '/tmp/test.txt' });
 * await client.disconnect();
 * ```
 */
export class AgentForgeMCPClient implements MCPClient {
  private _status: MCPStatus = 'disconnected';
  private _statusListeners = new Set<(status: MCPStatus) => void>();
  private _transport: MCPTransport | undefined;
  private _pendingRequests = new Map<JSONRPCId, PendingRequest>();
  private _requestId = 0;
  private _cachedTools: import('../core/interfaces.js').MCPTool[] = [];
  private _config: MCPServerConfig | undefined;

  constructor(
    config: MCPServerConfig,
    private options: MCPClientOptions
  ) {
    this._config = config;
  }

  /** Server name for identification (from options) */
  get serverName(): string {
    return this.options.serverName;
  }

  /**
   * Current connection status.
   */
  status(): MCPStatus {
    return this._status;
  }

  /**
   * Subscribe to status changes. Returns unsubscribe function.
   */
  onStatusChange(listener: (status: MCPStatus) => void): () => void {
    this._statusListeners.add(listener);
    // Replay current status immediately
    try {
      listener(this._status);
    } catch (err) {
      console.warn('[MCPClient] Status listener error:', err);
    }
    return () => {
      this._statusListeners.delete(listener);
    };
  }

  /** Set status and notify listeners */
  private _setStatus(status: MCPStatus): void {
    this._status = status;
    for (const listener of this._statusListeners) {
      try {
        listener(status);
      } catch (err) {
        console.warn('[MCPClient] Status listener error:', err);
      }
    }
  }

  /**
   * Connect to an MCP server.
   */
  async connect(): Promise<void> {
    if (this._status !== 'disconnected') {
      throw new Error('Client already connected or connecting');
    }

    if (this._config === undefined) {
      throw new Error('No configuration provided');
    }

    this._setStatus('connecting');
    this.emitEvent({
      type: 'mcp.connecting',
      timestamp: Date.now(),
      sessionId: this.options.sessionId,
      serverName: this.options.serverName,
    });

    try {
      // Create transport
      this._transport = createTransport(this._config);

      // Set up message handlers
      this._transport.onmessage = (message): void => {
        this.handleMessage(message);
      };
      this._transport.onerror = (error): void => {
        this.handleError(error);
      };
      this._transport.onclose = (): void => {
        this.handleClose();
      };

      // Connect transport
      await this._transport.connect();

      // Initialize handshake
      await this.initialize();

      // Cache tools
      this._cachedTools = await this.fetchTools();

      this._setStatus('connected');
      this.emitEvent({
        type: 'mcp.connected',
        timestamp: Date.now(),
        sessionId: this.options.sessionId,
        serverName: this.options.serverName,
        tools: this._cachedTools.map(t => t.name),
      });
    } catch (error) {
      this._setStatus('error');
      this.emitEvent({
        type: 'mcp.error',
        timestamp: Date.now(),
        sessionId: this.options.sessionId,
        serverName: this.options.serverName,
        error: this.serializeError(error),
      });
      throw error;
    }
  }

  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this._transport !== undefined) {
      await this._transport.close();
    }
    this._transport = undefined;

    // Reject all pending requests
    for (const pending of this._pendingRequests.values()) {
      pending.reject(new Error('Connection closed'));
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
    }
    this._pendingRequests.clear();

    this._setStatus('disconnected');
    this.emitEvent({
      type: 'mcp.disconnected',
      timestamp: Date.now(),
      sessionId: this.options.sessionId,
      serverName: this.options.serverName,
    });
  }

  /**
   * List available tools.
   */
  tools(): Promise<import('../core/interfaces.js').MCPTool[]> {
    return Promise.resolve([...this._cachedTools]);
  }

  /**
   * Call a tool on the server.
   *
   * Note: MCP errors are in result.isError, not thrown.
   * The caller decides how to handle tool errors.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this._status !== 'connected' || this._transport === undefined) {
      throw new Error('Client not connected');
    }

    const response = await this.request<MCPToolResponse>(
      {
        method: 'tools/call',
        params: { name, arguments: args },
      },
      this.options.timeout ?? 30000
    );

    // Validate response with Tier 1 contract
    const validated = validateMCPResponse(response);

    // Extract text content
    return this.extractContent(validated);
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Initialize handshake with the server.
   */
  private async initialize(): Promise<void> {
    await this.request<{ protocolVersion: string; capabilities: Record<string, unknown> }>({
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'agentforge', version: '1.0.0' },
      },
    });

    // Send initialized notification
    await this._transport!.send(createJSONRPCNotification('notifications/initialized'));
  }

  /**
   * Fetch tools from the server.
   */
  private async fetchTools(): Promise<import('../core/interfaces.js').MCPTool[]> {
    type ToolsListResponse = {
      tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
    };

    const response = await this.request<ToolsListResponse>({
      method: 'tools/list',
      params: {},
    });

    return response.tools.map(t => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema,
    }));
  }

  /**
   * Send a request and wait for response.
   */
  private async request<T>(
    message: { method: string; params?: Record<string, unknown> },
    timeoutMs?: number
  ): Promise<T> {
    if (this._transport === undefined) {
      throw new Error('Transport not connected');
    }

    const id = ++this._requestId;
    const request = createJSONRPCRequest(id, message.method, message.params);

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // Set up timeout
      if (timeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this._pendingRequests.delete(id);
          reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this._pendingRequests.set(id, pending);

      this._transport!.send(request).catch(error => {
        this._pendingRequests.delete(id);
        if (pending.timer !== undefined) {
          clearTimeout(pending.timer);
        }
        reject(error);
      });
    });
  }

  /**
   * Handle incoming message.
   */
  private handleMessage(message: import('./types.js').JSONRPCMessage): void {
    if (!isJSONRPCResponse(message)) {
      // Ignore notifications
      return;
    }

    const pending = this._pendingRequests.get(message.id);
    if (pending === undefined) {
      return;
    }

    this._pendingRequests.delete(message.id);
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }

    if (isJSONRPCSuccessResponse(message)) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(message.error.message));
    }
  }

  /**
   * Handle transport error.
   */
  private handleError(error: Error): void {
    this._setStatus('error');
    this.emitEvent({
      type: 'mcp.error',
      timestamp: Date.now(),
      sessionId: this.options.sessionId,
      serverName: this.options.serverName,
      error: this.serializeError(error),
    });
  }

  /**
   * Handle transport close.
   */
  private handleClose(): void {
    if (this._status === 'connected') {
      this._setStatus('disconnected');
      this.emitEvent({
        type: 'mcp.disconnected',
        timestamp: Date.now(),
        sessionId: this.options.sessionId,
        serverName: this.options.serverName,
      });
    }
  }

  /**
   * Extract text content from MCP response.
   */
  private extractContent(response: MCPToolResponse): string {
    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('\n');
  }

  /**
   * Serialize error for events.
   */
  private serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  /**
   * Emit event if handler is configured.
   */
  private emitEvent(event: MCPEvent): void {
    this.options.emitEvent?.(event);
  }
}

// ============================================================
// Transport Factory Registration
// ============================================================

// Register default transport factories
registerTransportFactory('stdio', createStdioTransport);
registerTransportFactory('http', createHTTPTransport);
registerTransportFactory('sse', createSSETransport);

// ============================================================
// Factory Function
// ============================================================

/**
 * Options for creating an MCP client.
 */
export interface CreateMCPClientOptions {
  /** Server name for event identification */
  serverName: string;
  /** Session ID for event correlation */
  sessionId: string;
  /** Tool call timeout in milliseconds */
  timeout?: number;
  /** Event emitter for MCP lifecycle events */
  emitEvent?: (event: MCPEvent) => void;
}

/**
 * Create an MCP client instance.
 *
 * @param config - MCP server configuration
 * @param options - Client options
 * @returns MCP client instance
 */
export function createMCPClient(
  config: MCPServerConfig,
  options: CreateMCPClientOptions
): MCPClient {
  return new AgentForgeMCPClient(config, options);
}
