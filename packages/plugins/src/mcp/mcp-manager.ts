import type { McpServerConfig } from '@primo-ai/sdk';
import type { McpClient } from './mcp-client.js';
import type { McpToolDefinition } from './tool-converter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// McpManager
// ---------------------------------------------------------------------------

/**
 * Manages MCP server connections at runtime.
 * Supports adding, removing, reconnecting, and querying MCP servers.
 * Accepts an optional clientFactory for dependency injection (testing).
 */
export class McpManager {
  private clients = new Map<string, { client: McpClient; config: McpServerConfig; tools: McpToolDefinition[] }>();

  constructor(private clientFactory?: (config: McpServerConfig) => McpClient) {}

  /**
   * Add a new MCP server. Creates a client, connects, and discovers tools.
   */
  async addServer(config: McpServerConfig): Promise<void> {
    const client = this.clientFactory
      ? this.clientFactory(config)
      : this.createDefaultClient(config);

    await client.connect();
    const tools = await client.discoverTools();

    this.clients.set(config.name, { client, config, tools });
  }

  /**
   * Remove an MCP server by name. Closes the client connection and removes the entry.
   * No-op if the server name does not exist.
   */
  async removeServer(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) return;

    await entry.client.close();
    this.clients.delete(name);
  }

  /**
   * Reconnect a previously added server (e.g., after a disconnect).
   * Throws if the server name does not exist.
   */
  async reconnect(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) {
      throw new Error(`Server not found: ${name}`);
    }

    // Close existing connection if still open
    if (entry.client.connected) {
      await entry.client.close();
    }

    // Create a fresh client and reconnect
    const client = this.clientFactory
      ? this.clientFactory(entry.config)
      : this.createDefaultClient(entry.config);

    await client.connect();
    const tools = await client.discoverTools();

    // Replace the entry with the new client
    this.clients.set(name, { client, config: entry.config, tools });
  }

  /**
   * List status for all managed servers.
   */
  listServers(): McpServerStatus[] {
    return Array.from(this.clients.entries()).map(([name, entry]) => ({
      name,
      connected: entry.client.connected,
      toolCount: entry.tools.length,
    }));
  }

  /**
   * Get tool definitions for a specific server.
   * Returns empty array if the server name does not exist.
   */
  getServerTools(name: string): McpToolDefinition[] {
    const entry = this.clients.get(name);
    if (!entry) return [];
    return entry.tools;
  }

  /**
   * Placeholder for default client creation.
   * In production, this would import createMcpClient from mcp-client.
   * For now, throws if no factory is provided (tests always provide a factory).
   */
  private createDefaultClient(_config: McpServerConfig): McpClient {
    throw new Error('No clientFactory provided. Pass a clientFactory to McpManager constructor.');
  }
}
