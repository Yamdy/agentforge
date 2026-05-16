import { z } from 'zod';
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
const McpPluginOptionsSchema = z.object({
  servers: z.array(z.object({
    name: z.string().min(1),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(),
  })).min(1),
  clientFactory: z.unknown().optional(),
});

export function mcpPlugin(options: McpPluginOptions): (api: HarnessAPI) => PluginRegistration {
  McpPluginOptionsSchema.parse(options);
  return (api: HarnessAPI): PluginRegistration => {
    const clientFactory = options.clientFactory ?? createMcpClient;

    for (const serverConfig of options.servers) {
      const registeredToolNames: string[] = [];

      const refreshTools = async (client: McpClient) => {
        // Unregister old tools from this server
        for (const name of registeredToolNames.splice(0)) {
          api.unregisterTool(name);
        }
        // Discover and register current tools
        const mcpTools = await client.discoverTools();
        for (const mcpTool of mcpTools) {
          const tool = convertMcpTool(mcpTool, serverConfig.name, (name, args) =>
            client.callTool(name, args),
          );
          api.registerTool(tool);
          registeredToolNames.push(tool.name);
        }
      };

      api.registerResource({
        id: `mcp:${serverConfig.name}`,
        type: 'mcp-server',
        config: serverConfig as unknown as Record<string, unknown>,
        start: async () => {
          const client = clientFactory(serverConfig);
          client.onToolsChanged = () => { refreshTools(client); };
          await client.connect();
          await refreshTools(client);
          return client;
        },
        stop: async (client) => {
          await (client as McpClient).close();
          // Clean up registered tools
          for (const name of registeredToolNames.splice(0)) {
            api.unregisterTool(name);
          }
        },
      });
    }

    return {};
  };
}
