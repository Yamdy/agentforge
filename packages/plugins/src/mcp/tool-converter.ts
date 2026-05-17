import type { ToolDefinition } from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Converts an MCP tool definition into a framework ToolDefinition.
 * Prefixes the tool name with `serverName__` to prevent cross-server collisions.
 * The execute() delegates to the provided callTool callback.
 */
export function convertMcpTool(
  mcpTool: McpToolDefinition,
  serverName: string,
  callTool: (name: string, args: unknown) => Promise<unknown>,
): ToolDefinition {
  return {
    name: `${serverName}__${mcpTool.name}`,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    execute: async (input: unknown) => {
      return callTool(mcpTool.name, input);
    },
  };
}
