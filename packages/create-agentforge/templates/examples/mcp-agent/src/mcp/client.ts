/**
 * MCP Client configuration for connecting to MCP servers.
 *
 * This module configures the MCP client that connects to
 * external tool servers using the Model Context Protocol.
 *
 * Configure your MCP servers below. Each server provides
 * a set of tools that the agent can discover and use.
 */

/**
 * MCP server configuration.
 * Add your MCP servers here.
 */
interface MCPServerConfig {
  /** Human-readable name for the server */
  name: string;
  /** Transport type: 'stdio' for local processes, 'sse' for remote servers */
  transport: 'stdio' | 'sse';
  /** Command to launch the server (stdio transport) */
  command?: string;
  /** Arguments for the command (stdio transport) */
  args?: string[];
  /** URL for SSE transport */
  url?: string;
}

const servers: MCPServerConfig[] = [
  // Example: Filesystem MCP server
  // {
  //   name: 'filesystem',
  //   transport: 'stdio',
  //   command: 'npx',
  //   args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  // },
  // Example: GitHub MCP server
  // {
  //   name: 'github',
  //   transport: 'stdio',
  //   command: 'npx',
  //   args: ['-y', '@modelcontextprotocol/server-github'],
  //   env: { GITHUB_TOKEN: process.env['GITHUB_TOKEN'] },
  // },
];

/**
 * MCP client instance.
 *
 * In a full implementation, this would connect to the configured
 * MCP servers and discover their available tools.
 *
 * For now, this exports the server configuration that the
 * agent's MCP integration will use.
 */
export const mcpClient = {
  servers,
  async connect(): Promise<void> {
    // MCP connection logic would go here
    // This would discover tools from each server
    console.log(`Connecting to ${servers.length} MCP server(s)...`);
    for (const server of servers) {
      console.log(`  - ${server.name} (${server.transport})`);
    }
  },
  async disconnect(): Promise<void> {
    console.log('Disconnecting from MCP servers...');
  },
};