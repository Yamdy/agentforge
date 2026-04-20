import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Tool } from "@agentforge/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema, type Content } from "@modelcontextprotocol/sdk/types.js";
import { MCPError } from "./types.js";
import { Effect } from "effect";

/**
 * 转换 MCP 工具定义为 agentforge Tool 格式
 * @param serverName 服务器名称，用于工具前缀，避免冲突
 * @param mcpTool MCP 工具定义
 * @param client MCP 客户端实例
 * @param timeout 工具调用超时
 */
export function convertMcpTool(
  serverName: string,
  mcpTool: MCPTool,
  client: Client,
  timeout?: number
): Tool {
  // 处理 JSON Schema，确保符合 zod 格式要求
  const inputSchema = mcpTool.inputSchema;
  const schema = z.object(
    (inputSchema?.properties ?? {}) as any,
    inputSchema?.required ?? []
  ).strict();

  // 生成工具名称，添加服务器前缀避免冲突，替换非字母数字字符为下划线
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9_]/g, "_");
  const toolName = `${sanitize(serverName)}_${sanitize(mcpTool.name)}`;

  // 创建工具
  return {
    name: toolName,
    description: mcpTool.description ?? "",
    parameters: schema,
    execute: (args: Record<string, unknown>) =>
      Effect.tryPromise(async () => {
        const result = await client.callTool(
          {
            name: mcpTool.name,
            arguments: args,
          },
          CallToolResultSchema,
          {
            resetTimeoutOnProgress: true,
            timeout,
          }
        );

      // 转换结果为字符串
      const content = result.content as Content[];
      if (content.length === 0) {
        return "";
      }

      // 处理内容
      return content
        .map((item) => {
          if (item.type === "text") {
            return item.text;
          }
          if (item.type === "image") {
            return `![Image](data:${item.mimeType};base64,${item.data})`;
          }
          if (item.type === "embedded_resource") {
            return `Embedded resource: ${item.name}`;
          }
          return JSON.stringify(item);
        })
        .join("\n");
      }).pipe(
        Effect.mapError((err) => {
          return new MCPError(
            `Tool call failed: ${err instanceof Error ? err.message : String(err)}`,
            err
          );
        })
      ),
  };
}
