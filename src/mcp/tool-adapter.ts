/**
 * MCP Tool to AgentForge ToolDefinition Adapter
 *
 * Converts MCP tool definitions to AgentForge ToolDefinition format,
 * including JSON Schema to Zod conversion.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/08-SUBSYSTEMS.md
 */

import { z, type ZodTypeAny } from 'zod';
import type { ToolDefinition, MCPClient } from '../core/interfaces.js';
import type { MCPTool } from '../core/interfaces.js';

// ============================================================
// JSON Schema to Zod Conversion
// ============================================================

/**
 * Convert a JSON Schema property to a Zod type.
 */
function jsonSchemaPropertyToZod(prop: Record<string, unknown>): ZodTypeAny {
  const type = prop.type as string | undefined;

  switch (type) {
    case 'string':
      if (prop.enum !== undefined && Array.isArray(prop.enum)) {
        // Enum type
        const enumValues = prop.enum as [string, ...string[]];
        return z.enum(enumValues);
      }
      return z.string();

    case 'number':
    case 'integer':
      if (prop.minimum !== undefined && prop.maximum !== undefined) {
        // Number with range
        return z
          .number()
          .min(prop.minimum as number)
          .max(prop.maximum as number);
      }
      if (prop.minimum !== undefined) {
        return z.number().min(prop.minimum as number);
      }
      if (prop.maximum !== undefined) {
        return z.number().max(prop.maximum as number);
      }
      return z.number();

    case 'boolean':
      return z.boolean();

    case 'array':
      if (prop.items !== undefined && typeof prop.items === 'object') {
        const itemsSchema = jsonSchemaPropertyToZod(prop.items as Record<string, unknown>);
        return z.array(itemsSchema);
      }
      return z.array(z.unknown());

    case 'object':
      return jsonSchemaToZod(prop);

    case 'null':
      return z.null();

    default:
      // Unknown or missing type - be permissive
      return z.unknown();
  }
}

/**
 * Convert a JSON Schema object to a Zod object.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodObject<Record<string, ZodTypeAny>> {
  const type = schema.type as string | undefined;

  if (type !== 'object') {
    // Non-object schemas get wrapped in a loose object
    return z.object({});
  }

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;

  if (properties === undefined || Object.keys(properties).length === 0) {
    return z.object({});
  }

  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    const zodType = jsonSchemaPropertyToZod(prop);

    if (required !== undefined && required.includes(key)) {
      shape[key] = zodType;
    } else {
      shape[key] = zodType.optional();
    }
  }

  return z.object(shape);
}

// ============================================================
// Tool Adapter
// ============================================================

/**
 * Convert an MCP tool to an AgentForge ToolDefinition.
 *
 * The tool name is prefixed with "mcp_" to distinguish from local tools.
 *
 * @param tool - MCP tool definition
 * @param mcpClient - MCP client for executing the tool
 * @param serverName - Server name for namespacing (optional)
 * @returns AgentForge ToolDefinition
 */
export function adaptMCPTool(
  tool: MCPTool,
  mcpClient: MCPClient,
  serverName?: string
): ToolDefinition {
  // Create namespaced tool name
  const toolName = serverName !== undefined ? `mcp_${serverName}_${tool.name}` : `mcp_${tool.name}`;

  // Convert input schema to Zod
  const parameters = jsonSchemaToZod(tool.inputSchema);

  return {
    name: toolName,
    description: tool.description ?? `MCP tool: ${tool.name}`,
    parameters,
    execute: async (args: unknown): Promise<string> => {
      // Validate args type
      const typedArgs = args as Record<string, unknown>;
      return mcpClient.callTool(tool.name, typedArgs);
    },
  };
}

/**
 * Convert multiple MCP tools to AgentForge ToolDefinitions.
 *
 * @param tools - Array of MCP tool definitions
 * @param mcpClient - MCP client for executing tools
 * @param serverName - Server name for namespacing (optional)
 * @returns Array of AgentForge ToolDefinitions
 */
export function adaptMCPTools(
  tools: MCPTool[],
  mcpClient: MCPClient,
  serverName?: string
): ToolDefinition[] {
  return tools.map(tool => adaptMCPTool(tool, mcpClient, serverName));
}

// ============================================================
// Tool Name Utilities
// ============================================================

/**
 * Check if a tool name is an MCP tool.
 */
export function isMCPToolName(toolName: string): boolean {
  return toolName.startsWith('mcp_');
}

/**
 * Parse an MCP tool name to extract server and tool name.
 *
 * @param toolName - Namespaced tool name (e.g., "mcp_filesystem_read_file")
 * @returns Object with serverName and originalToolName, or null if not an MCP tool
 */
export function parseMCPToolName(
  toolName: string
): { serverName: string; originalToolName: string } | null {
  if (!isMCPToolName(toolName)) {
    return null;
  }

  // Remove "mcp_" prefix
  const remainder = toolName.slice(4);

  // Split on first underscore: serverName_toolName
  const underscoreIndex = remainder.indexOf('_');
  if (underscoreIndex === -1) {
    // No server name, just tool name
    return { serverName: '', originalToolName: remainder };
  }

  const serverName = remainder.slice(0, underscoreIndex);
  const originalToolName = remainder.slice(underscoreIndex + 1);

  return { serverName, originalToolName };
}

/**
 * Create a namespaced MCP tool name.
 *
 * @param serverName - Server name
 * @param toolName - Original tool name
 * @returns Namespaced tool name
 */
export function createMCPToolName(serverName: string, toolName: string): string {
  if (serverName === '') {
    return `mcp_${toolName}`;
  }
  return `mcp_${serverName}_${toolName}`;
}

// ============================================================
// Schema Conversion Utilities (Exported for testing)
// ============================================================

/**
 * Convert JSON Schema to Zod schema (exported for testing and advanced use).
 */
export { jsonSchemaToZod };
