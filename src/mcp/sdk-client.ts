/**
 * MCP Client using Official SDK
 *
 * Wrapper around @modelcontextprotocol/sdk for reliable MCP communication.
 * All 5 analyzed projects use the official SDK - AgentForge should too.
 *
 * @packageDocumentation
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from '../core/interfaces.js';
import type { JSONSchema7 } from 'json-schema';

// ============================================================
// Types
// ============================================================

export interface MCPSDKClientOptions {
  serverName: string;
  sessionId: string;
  timeout?: number;
  emitEvent?: (event: MCPEvent) => void;
}

export interface MCPEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  serverName: string;
  [key: string]: unknown;
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema: JSONSchema7;
}

export interface MCPResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPromptInfo {
  name: string;
  description?: string;
}

// ============================================================
// MCP SDK Client
// ============================================================

/**
 * MCP Client using official @modelcontextprotocol/sdk
 */
export class MCPSDKClient {
  private client: Client | undefined;
  private transport:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined;
  private _connected = false;

  constructor(
    private config: MCPServerConfig,
    private options: MCPSDKClientOptions
  ) {}

  /**
   * Connect to MCP server
   */
  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    this.emitEvent({ type: 'mcp.connecting' });

    try {
      // Create transport based on config type
      if (this.config.type === 'stdio') {
        const command = this.config.command;
        if (!command) {
          throw new Error('MCP stdio config requires "command" field');
        }
        // Build transport options - only include env if defined
        const transportOptions: { command: string; args: string[]; env?: Record<string, string> } =
          {
            command,
            args: this.config.args ?? [],
          };
        if (this.config.env) {
          transportOptions.env = this.config.env;
        }
        this.transport = new StdioClientTransport(transportOptions);
      } else if (this.config.type === 'http') {
        const url = this.config.url;
        if (!url) {
          throw new Error('MCP http config requires "url" field');
        }
        this.transport = new StreamableHTTPClientTransport(new URL(url));
      } else {
        // SSE fallback for legacy HTTP servers
        const url = this.config.url;
        if (!url) {
          throw new Error('MCP sse config requires "url" field');
        }
        this.transport = new SSEClientTransport(new URL(url));
      }

      // Create client
      this.client = new Client({ name: 'agentforge', version: '0.1.0' }, { capabilities: {} });

      // Connect - use type assertion to work around SDK type issue
      await this.client.connect(this.transport as Parameters<Client['connect']>[0]);
      this._connected = true;

      this.emitEvent({ type: 'mcp.connected' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: 'mcp.error', error: message });
      throw error;
    }
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    if (this.client && this._connected) {
      await this.client.close();
      this._connected = false;
      this.emitEvent({ type: 'mcp.disconnected' });
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * List available tools
   */
  async tools(): Promise<MCPToolInfo[]> {
    this.ensureConnected();

    const result = await this.client!.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema
    );

    // Use conditional spread to avoid undefined assignment
    return result.tools.map(tool => {
      const info: MCPToolInfo = {
        name: tool.name,
        inputSchema: tool.inputSchema as JSONSchema7,
      };
      if (tool.description) {
        info.description = tool.description;
      }
      return info;
    });
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    this.ensureConnected();

    const result = await this.client!.request(
      {
        method: 'tools/call',
        params: { name, arguments: args },
      },
      CallToolResultSchema
    );

    // Extract text content from result
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content
        .filter(c => c.type === 'text')
        .map(c => (c as { text: string }).text)
        .join('\n');
      return textContent || JSON.stringify(result.content);
    }

    return JSON.stringify(result);
  }

  /**
   * List available resources
   */
  async resources(): Promise<MCPResourceInfo[]> {
    this.ensureConnected();

    try {
      const result = await this.client!.request(
        { method: 'resources/list', params: {} },
        ListResourcesResultSchema
      );

      // Use conditional spread to avoid undefined assignment
      return result.resources.map(res => {
        const info: MCPResourceInfo = {
          uri: res.uri,
          name: res.name,
        };
        if (res.description) {
          info.description = res.description;
        }
        if (res.mimeType) {
          info.mimeType = res.mimeType;
        }
        return info;
      });
    } catch {
      // Server may not support resources
      return [];
    }
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<string> {
    this.ensureConnected();

    const result = await this.client!.request(
      { method: 'resources/read', params: { uri } },
      ReadResourceResultSchema
    );

    if (result.contents && Array.isArray(result.contents)) {
      const textContent = result.contents
        .filter(c => 'text' in c)
        .map(c => (c as { text: string }).text)
        .join('\n');
      return textContent || JSON.stringify(result.contents);
    }

    return JSON.stringify(result);
  }

  /**
   * List available prompts
   */
  async prompts(): Promise<MCPPromptInfo[]> {
    this.ensureConnected();

    try {
      const result = await this.client!.request(
        { method: 'prompts/list', params: {} },
        ListPromptsResultSchema
      );

      // Use conditional spread to avoid undefined assignment
      return result.prompts.map(p => {
        const info: MCPPromptInfo = {
          name: p.name,
        };
        if (p.description) {
          info.description = p.description;
        }
        return info;
      });
    } catch {
      return [];
    }
  }

  /**
   * Get a prompt
   */
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<string> {
    this.ensureConnected();

    const result = await this.client!.request(
      { method: 'prompts/get', params: { name, arguments: args } },
      GetPromptResultSchema
    );

    if (result.messages && Array.isArray(result.messages)) {
      return result.messages
        .map(m => {
          if ('content' in m && typeof m.content === 'object') {
            const content = m.content as { type?: string; text?: string };
            if (content.type === 'text' && content.text) {
              return content.text;
            }
          }
          return JSON.stringify(m);
        })
        .join('\n');
    }

    return JSON.stringify(result);
  }

  // ============================================================
  // Private Methods
  // ============================================================

  private ensureConnected(): void {
    if (!this._connected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }
  }

  private emitEvent(event: Partial<MCPEvent>): void {
    if (this.options.emitEvent) {
      this.options.emitEvent({
        type: event.type ?? 'mcp.event',
        timestamp: Date.now(),
        sessionId: this.options.sessionId,
        serverName: this.options.serverName,
        ...event,
      });
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create MCP client using official SDK
 */
export function createMCPSDKClient(
  config: MCPServerConfig,
  options: MCPSDKClientOptions
): MCPSDKClient {
  return new MCPSDKClient(config, options);
}
