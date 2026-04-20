import { Effect } from "effect";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfigLocal, MCPServerConfigRemote, MCPServerConfig } from "./types.js";
import { MCPError } from "./types.js";

/**
 * 为本地服务器创建 stdio 传输
 * @param config 本地服务器配置
 */
export function createStdioTransport(
  config: MCPServerConfigLocal
): Effect.Effect<StdioClientTransport, MCPError> {
  return Effect.sync(() => {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.workingDirectory,
      env: config.env,
      stderr: "pipe",
    });
  }).pipe(
    Effect.mapError((err) => new MCPError("Failed to create stdio transport", err))
  );
}

/**
 * 创建远程 HTTP 传输
 * @param config 远程服务器配置
 * @param authProvider 可选认证提供者
 */
export function createHttpTransport(
  config: MCPServerConfigRemote,
  authProvider?: any
): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(config.url), {
    authProvider,
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });
}

/**
 * 创建 SSE 传输
 * @param config 远程服务器配置
 * @param authProvider 可选认证提供者
 */
export function createSSETransport(
  config: MCPServerConfigRemote,
  authProvider?: any
): SSEClientTransport {
  return new SSEClientTransport(new URL(config.url), {
    authProvider,
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });
}

/**
 * 创建对应传输类型
 * @param config 服务器配置
 * @param authProvider 可选认证提供者
 */
export function createTransport(
  config: MCPServerConfig,
  authProvider?: any
): Effect.Effect<Transport, MCPError> {
  if (config.type === "local") {
    return createStdioTransport(config);
  } else {
    // 先尝试 StreamableHTTP，再尝试 SSE
    try {
      return Effect.succeed(createHttpTransport(config, authProvider));
    } catch (e) {
      // 尝试 SSE 传输
      try {
        return Effect.succeed(createSSETransport(config, authProvider));
      } catch (err) {
        return Effect.fail(new MCPError("Failed to create transport", err));
      }
    }
  }
}
