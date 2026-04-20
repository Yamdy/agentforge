import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Effect, pipe } from "effect";
import { createTransport, createHttpTransport } from "./transports.js";
import { convertMcpTool } from "./convert.js";
import type {
  MCPManager,
  MCPServerConfig,
  MCPServerStatus,
  MCPClientInstance,
} from "./types.js";
import { MCPError } from "./types.js";
import { OAuthCallbackServer, generateOAuthState, openAuthUrl } from "./oauth.js";

export interface MCPClientOptions {
  /** 服务器配置集合 */
  config: Record<string, MCPServerConfig>;
}

export class MCPClientManager implements MCPManager {
  private clients: Map<string, MCPClientInstance> = new Map();
  private config: Record<string, MCPServerConfig>;

  constructor(options: MCPClientOptions) {
    this.config = options.config;
  }

  /**
   * 连接所有启用的服务器
   */
  connectAll(): Effect.Effect<void, MCPError> {
    const self = this;
    return Effect.gen(function* () {
      for (const name of Object.keys(self.config)) {
        const config = self.config[name];
        if (config.enabled !== false) {
          try {
            yield* self.connect(name);
          } catch (err) {
            console.warn(`Failed to connect to MCP server "${name}":`, err);
          }
        }
      }
    });
  }

  /**
   * 连接指定服务器
   */
  connect = (name: string): Effect.Effect<void, MCPError> => {
    const self = this;
    return Effect.gen(function* () {
      const config = this.config[name];
      if (!config) {
        yield* Effect.fail(new MCPError(`MCP server "${name}" not found in config`));
        return;
      }

      if (config.enabled === false) {
        this.clients.set(name, {
          client: null as any,
          config,
          status: { status: "disabled" },
          tools: [],
        });
        return;
      }

      // 创建传输
      const transport = yield* createTransport(config);
      
      // 创建客户端
      const client = new Client(
        { name: "agentforge", version: "0.1.0" },
        { capabilities: {} }
      );

      // 连接
      try {
        yield* Effect.tryPromise(() =>
          client.connect(transport, { timeout: config.timeout ?? 30000 })
        );
      } catch (err: any) {
        if (err instanceof UnauthorizedError) {
          this.clients.set(name, {
            client: null as any,
            config,
            status: { status: "needs_auth" },
            tools: [],
          });
          console.log(`MCP server "${name}" needs authentication`);
          return;
        }
        yield* Effect.fail(new MCPError(`Failed to connect to server "${name}"`, err));
        return;
      }

      // 获取工具列表
      const toolsResult = yield* Effect.tryPromise(() =>
        client.listTools({})
      );

      // 监听工具更新
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        console.log(`MCP server "${name}" tools changed, reloading...`);
        try {
          const updatedTools = await client.listTools({});
          const instance = this.clients.get(name);
          if (instance) {
            instance.tools = updatedTools.tools;
          }
        } catch (err) {
          console.warn(`Failed to reload tools for MCP server "${name}":`, err);
        }
      });

      // 保存客户端实例
      this.clients.set(name, {
        client,
        config,
        status: { status: "connected" },
        tools: toolsResult.tools,
      });

      console.log(`MCP server "${name}" connected, ${toolsResult.tools.length} tools available`);
    });
  };

  /**
   * 断开指定服务器连接
   */
  disconnect = (name: string): Effect.Effect<void, MCPError> => {
    return Effect.gen(function* () {
      const instance = this.clients.get(name);
      if (!instance) return;

      // 关闭客户端
      yield* Effect.tryPromise(() => instance.client.close()).pipe(
        Effect.catchAll((err) => {
          console.warn(`Failed to close MCP client for "${name}":`, err);
          return Effect.void;
        })
      );

      // 移除实例
      this.clients.delete(name);
      console.log(`MCP server "${name}" disconnected`);
    });
  };

  /**
   * 断开所有服务器连接
   */
  disconnectAll(): Effect.Effect<void, MCPError> {
    return Effect.gen(function* () {
      for (const name of this.clients.keys()) {
        yield* this.disconnect(name);
      }
    });
  }

  /**
   * 获取所有服务器状态
   */
  status = (): Effect.Effect<Record<string, MCPServerStatus>, MCPError> => {
    return Effect.gen(function* () {
      const result: Record<string, MCPServerStatus> = {};
      for (const [name, config] of Object.entries(this.config)) {
        const instance = this.clients.get(name);
        result[name] = instance?.status ?? { status: "disabled" };
      }
      return result;
    });
  };

  /**
   * 获取所有可用工具
   */
  tools = (): Effect.Effect<Record<string, Tool>, MCPError> => {
    return Effect.gen(function* () {
      const result: Record<string, any> = {};

      for (const [name, instance] of this.clients) {
        if (instance.status.status !== "connected") continue;

        for (const mcpTool of instance.tools) {
          const tool = convertMcpTool(
            name,
            mcpTool,
            instance.client,
            instance.config.timeout ?? 30000
          );
          result[tool.name] = tool;
        }
      }

      return result;
    });
  };

  /**
   * 获取指定服务器的工具
   */
  getServerTools = (name: string): Effect.Effect<Record<string, Tool>, MCPError> => {
    return Effect.gen(function* () {
      const instance = this.clients.get(name);
      if (!instance || instance.status.status !== "connected") {
        yield* Effect.fail(new MCPError(`MCP server "${name}" not connected`));
        return {};
      }

      const result: Record<string, any> = {};
      for (const mcpTool of instance.tools) {
        const tool = convertMcpTool(
          name,
          mcpTool,
          instance.client,
          instance.config.timeout ?? 30000
        );
        result[tool.name] = tool;
      }

      return result;
    });
  };

  /**
   * 开始 OAuth 认证流程
   */
  startAuth = (name: string): Effect.Effect<{ authorizationUrl: string; oauthState: string }, MCPError> => {
    return Effect.gen(function* () {
      const config = this.config[name];
      if (!config || config.type !== "remote" || !config.oauth) {
        yield* Effect.fail(new MCPError(`Server "${name}" is not a remote server with OAuth enabled`));
        return { authorizationUrl: "", oauthState: "" };
      }

      // 确保回调服务运行
      yield* OAuthCallbackServer.ensureRunning();

      // 生成 state
      const state = generateOAuthState();
      const redirectUri = OAuthCallbackServer.getRedirectUri();

      // 尝试连接触发认证跳转
      let authUrl: string | null = null;
      try {
        const client = new Client({ name: "agentforge", version: "0.1.0" }, { capabilities: {} });
        const authProvider: any = {
          getAuthorizationHeader: async () => {
            throw new UnauthorizedError("Auth required");
          },
        };
        const transport = createHttpTransport(config, authProvider);
        yield* Effect.tryPromise(() => client.connect(transport, { timeout: config.timeout ?? 30000 }));
        yield* Effect.tryPromise(() => client.close());
      } catch (err: any) {
        // 获取跳转 URL
        if (err instanceof UnauthorizedError) {
          authUrl = (err as any).authUrl;
        } else {
          yield* Effect.fail(new MCPError("Failed to start OAuth flow", err));
          return { authorizationUrl: "", oauthState: "" };
        }
      }

      if (!authUrl) {
        yield* Effect.fail(new MCPError("Failed to get authorization URL"));
        return { authorizationUrl: "", oauthState: "" };
      }

      // 打开浏览器
      yield* openAuthUrl(authUrl);

      return {
        authorizationUrl: authUrl,
        oauthState: state,
      };
    });
  };

  /**
   * 完成 OAuth 认证
   */
  finishAuth = (name: string, code: string): Effect.Effect<MCPServerStatus, MCPError> => {
    return Effect.gen(function* () {
      // 完成认证后重新连接
      yield* this.disconnect(name);
      yield* this.connect(name);
      
      const instance = this.clients.get(name);
      return instance?.status ?? { status: "failed", error: "Failed to connect after authentication" };
    });
  };
}
