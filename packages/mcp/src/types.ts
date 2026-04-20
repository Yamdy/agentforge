import type { Effect } from "effect";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@agentforge/core";
import { SessionError } from "@agentforge/core";

/**
 * MCP 错误类型
 */
export class MCPError extends SessionError {
  name = "MCPError";
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/**
 * MCP 服务器状态
 */
export type MCPServerStatus = 
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string };

/**
 * 本地 MCP 服务器配置
 */
export interface MCPServerConfigLocal {
  type: "local";
  command: string;
  args: string[];
  enabled?: boolean;
  env?: Record<string, string>;
  timeout?: number;
  workingDirectory?: string;
}

/**
 * 远程 MCP 服务器配置
 */
export interface MCPServerConfigRemote {
  type: "remote";
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  timeout?: number;
  oauth?: {
    clientId: string;
    clientSecret: string;
    scope?: string;
  };
}

/**
 * 统一 MCP 服务器配置
 */
export type MCPServerConfig = MCPServerConfigLocal | MCPServerConfigRemote;

/**
 * MCP 工具信息，包含所属服务器
 */
export interface MCPToolInfo {
  /** 服务器名称 */
  server: string;
  /** MCP 原始工具定义 */
  mcpTool: MCPTool;
  /** 转换后的 agentforge 工具 */
  tool: Tool;
}

/**
 * MCP 管理器接口
 */
export interface MCPManager {
  /**
   * 获取所有可用的 MCP 工具
   */
  tools: () => Effect.Effect<Record<string, Tool>, MCPError>;

  /**
   * 获取所有服务器连接状态
   */
  status: () => Effect.Effect<Record<string, MCPServerStatus>, MCPError>;

  /**
   * 连接指定服务器
   * @param name 服务器名称
   */
  connect: (name: string) => Effect.Effect<void, MCPError>;

  /**
   * 断开指定服务器连接
   * @param name 服务器名称
   */
  disconnect: (name: string) => Effect.Effect<void, MCPError>;

  /**
   * 获取指定服务器的所有工具
   * @param name 服务器名称
   */
  getServerTools: (name: string) => Effect.Effect<Record<string, Tool>, MCPError>;

  /**
   * 开始指定服务器的 OAuth 认证流程
   * @param name 服务器名称
   */
  startAuth: (name: string) => Effect.Effect<{ authorizationUrl: string; oauthState: string }, MCPError>;

  /**
   * 完成 OAuth 认证
   * @param name 服务器名称
   * @param code 授权码
   */
  finishAuth: (name: string, code: string) => Effect.Effect<MCPServerStatus, MCPError>;
}

/**
 * MCP 客户端实例
 */
export interface MCPClientInstance {
  /** 客户端实例 */
  client: Client;
  /** 服务器配置 */
  config: MCPServerConfig;
  /** 连接状态 */
  status: MCPServerStatus;
  /** 工具列表 */
  tools: MCPTool[];
}
