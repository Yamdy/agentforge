import type { HarnessAPI, PluginRegistration, McpServerConfig } from '@agentforge/sdk';
import { convertMcpTool } from './tool-converter.js';
import { createMcpClient, type McpClient } from './mcp-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpPluginOptions {
  servers: McpServerConfig[];
  clientFactory?: (config: McpServerConfig) => McpClient;
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

/**
 * MCP Plugin factory.
 *
 * For each server in options.servers, registers a ResourceDeclaration that:
 * 1. On start(): connects to the MCP server, discovers tools, and registers
 *    them as framework tools (prefixed with `serverName__`).
 * 2. On stop(): closes the MCP client connection.
 *
 * Uses closure capture to access HarnessAPI inside ResourceDeclaration.start().
 */
export function mcpPlugin(options: McpPluginOptions): (api: HarnessAPI) => PluginRegistration {
  return (api: HarnessAPI): PluginRegistration => {
    const clientFactory = options.clientFactory ?? createMcpClient;

    for (const serverConfig of options.servers) {
      api.registerResource({
        id: `mcp:${serverConfig.name}`,
        type: 'mcp-server',
        config: serverConfig as unknown as Record<string, unknown>,
        start: async () => {
          const client = clientFactory(serverConfig);
          await client.connect();
          const mcpTools = await client.discoverTools();
          for (const mcpTool of mcpTools) {
            const tool = convertMcpTool(mcpTool, serverConfig.name, (name, args) =>
              client.callTool(name, args),
            );
            api.registerTool(tool);
          }
          return client;
        },
        stop: async (client) => {
          await (client as McpClient).close();
        },
      });
    }

    return {};
  };
}
