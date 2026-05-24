import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  CallToolResultSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type LegacyTool as Tool, type ToolParameters } from '../types.js';
import { config } from './config.js';
import type { McpServerConfig, McpStatus } from './types.js';
import { createStdioTransport, createStreamableHTTPTransport } from './transport/index.js';

const DEFAULT_TIMEOUT = 30000;
const VERSION = '0.1.0';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

interface ClientState {
  client: Client | null;
  config: McpServerConfig;
  status: McpStatus;
}

class McpClient {
  private clients: Map<string, ClientState> = new Map();

  async init(): Promise<void> {
    await config.load();
    const servers = config.getServers();
    await Promise.all(
      Object.entries(servers).map(async ([name, cfg]) => {
        if (cfg.enabled) {
          try {
            await this.connect(name, cfg);
          } catch (e) {
            console.error(`Failed to connect to ${name}:`, e);
          }
        }
      })
    );
  }

  async add(name: string, serverConfig: McpServerConfig): Promise<McpStatus> {
    await config.setServer(name, serverConfig);
    if (serverConfig.enabled) {
      return this.connect(name, serverConfig);
    }
    return { status: 'disabled' };
  }

  async remove(name: string): Promise<void> {
    const state = this.clients.get(name);
    if (state?.client) {
      await state.client.close().catch(() => {});
    }
    this.clients.delete(name);
    await config.removeServer(name);
  }

  async connect(name: string, cfg?: McpServerConfig): Promise<McpStatus> {
    const serverConfig = cfg || config.getServer(name);
    if (!serverConfig) {
      throw new Error(`Server ${name} not found`);
    }

    const existing = this.clients.get(name);
    if (existing?.client) {
      await existing.client.close().catch(() => {});
    }

    try {
      const client = new Client({ name: 'agentforge', version: VERSION });
      let transport: Transport;

      if (serverConfig.type === 'local') {
        const [cmd, ...args] = serverConfig.command;
        transport = createStdioTransport(cmd, args, { env: serverConfig.env });
      } else {
        transport = createStreamableHTTPTransport(serverConfig.url, {
          requestInit: serverConfig.headers ? { headers: serverConfig.headers } : undefined,
        });
      }

      await client.connect(transport);
      this.registerNotificationHandlers(client, name);
      await client.listTools();

      const status: McpStatus = { status: 'connected' };
      this.clients.set(name, { client, config: serverConfig, status });
      return status;
    } catch (error) {
      const status: McpStatus = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      this.clients.set(name, { client: null, config: serverConfig, status });
      return status;
    }
  }

  async disconnect(name: string): Promise<void> {
    const state = this.clients.get(name);
    if (state?.client) {
      await state.client.close().catch(() => {});
      this.clients.delete(name);
    }
  }

  status(): Record<string, McpStatus> {
    const result: Record<string, McpStatus> = {};
    const servers = config.getServers();
    for (const [name] of Object.entries(servers)) {
      const state = this.clients.get(name);
      result[name] = state?.status || { status: 'disabled' };
    }
    return result;
  }

  async tools(): Promise<Record<string, Tool>> {
    const result: Record<string, Tool> = {};
    for (const [name, state] of this.clients) {
      if (state.status.status !== 'connected' || !state.client) continue;
      try {
        const toolsResult = await state.client.listTools();
        for (const mcpTool of toolsResult.tools) {
          const toolName = `${name}_${mcpTool.name}`;
          result[toolName] = await this.convertMcpTool(mcpTool, state.client, state.config.timeout);
        }
      } catch (e) {
        console.error(`Failed to get tools from ${name}:`, e);
      }
    }
    return result;
  }

  private async convertMcpTool(
    mcpTool: MCPToolDef,
    client: Client,
    timeout?: number
  ): Promise<Tool> {
    const inputSchema = mcpTool.inputSchema;
    const parameters: ToolParameters = {
      type: 'object',
      properties: (inputSchema.properties ?? {}) as Record<string, unknown>,
      required: (inputSchema.required ?? []) as string[],
    };

    return {
      name: mcpTool.name,
      description: mcpTool.description ?? '',
      parameters,
      execute: async (args: Record<string, unknown>) => {
        const result = await client.callTool(
          {
            name: mcpTool.name,
            arguments: args,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout: timeout ?? DEFAULT_TIMEOUT,
          }
        );
        return JSON.stringify(result);
      },
    };
  }

  private registerNotificationHandlers(client: Client, serverName: string): void {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      console.log(`Tools changed for ${serverName}`);
    });
  }
}

export const client = new McpClient();
