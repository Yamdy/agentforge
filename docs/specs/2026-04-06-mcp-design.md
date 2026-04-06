# MCP (Model Context Protocol) 功能设计文档

**日期**: 2026-04-06
**版本**: 1.0.0
**作者**: Primo Agent Team

## 概述

为 Primo Agent 框架添加完整的 MCP (Model Context Protocol) 支持，参考了 opencode、AgentScope 和 Mastra 三个项目的设计。

## 参考项目

- **opencode (D:\code\opencode)**: MCP 客户端核心实现、OAuth 认证
- **AgentScope (D:\code\agentscope)**: 工具分组管理、异步任务
- **Mastra (D:\code\mastra)**: 会话管理、重连机制、多传输协议

## 架构设计

### 目录结构

```
src/mcp/
├── index.ts              # 主入口，MCP 命名空间
├── client.ts             # MCP 客户端管理
├── config.ts             # 配置管理
├── types.ts              # 类型定义
├── toolkit.ts            # 工具分组管理
├── auth.ts               # OAuth 认证
├── oauth-provider.ts     # OAuth 提供者
├── oauth-callback.ts     # OAuth 回调服务器
└── transport/
    ├── index.ts
    ├── stdio.ts          # Stdio 传输
    ├── sse.ts            # SSE 传输
    └── streamable-http.ts # Streamable HTTP 传输
```

### 核心模块

#### 1. MCP 命名空间 (index.ts)

导出所有公共 API 和类型。

#### 2. 客户端管理 (client.ts)

- 管理多个 MCP 服务器连接
- 支持本地 (stdio) 和远程 (HTTP/SSE) 服务器
- 连接状态管理
- 工具、资源、提示获取

#### 3. 工具分组管理 (toolkit.ts)

参考 AgentScope 的 Toolkit 设计：

- "basic" 组：始终激活的工具
- 自定义组：可动态激活/停用
- 组级别说明文档

#### 4. 配置管理 (config.ts)

支持多种配置方式：

- 代码配置：`MCP.add()`
- 配置文件：`mcp.config.json`
- 环境变量：`MCP_SERVERS_*`

## 核心 API

### 服务器管理

```typescript
// 添加 MCP 服务器
MCP.add(name: string, config: McpServerConfig): Promise<McpStatus>

// 移除 MCP 服务器
MCP.remove(name: string): Promise<void>

// 连接服务器
MCP.connect(name: string): Promise<void>

// 断开连接
MCP.disconnect(name: string): Promise<void>

// 获取所有服务器状态
MCP.status(): Promise<Record<string, McpStatus>>
```

### 工具管理

```typescript
// 获取所有已连接服务器的工具
MCP.tools(): Promise<Record<string, Tool>>

// 工具分组 API
MCP.Toolkit.registerGroup(name: string, tools: Tool[]): void
MCP.Toolkit.activateGroup(name: string): void
MCP.Toolkit.deactivateGroup(name: string): void
MCP.Toolkit.getTools(groups?: string[]): Tool[]
```

### 资源和提示

```typescript
// 获取资源
MCP.resources(): Promise<Record<string, McpResource>>
MCP.readResource(clientName: string, uri: string): Promise<any>

// 获取提示
MCP.prompts(): Promise<Record<string, McpPrompt>>
MCP.getPrompt(clientName: string, name: string, args?: Record<string, string>): Promise<any>
```

### OAuth 认证

```typescript
// 启动认证流程
MCP.authenticate(name: string): Promise<McpStatus>

// 移除认证凭证
MCP.removeAuth(name: string): Promise<void>

// 检查认证状态
MCP.getAuthStatus(name: string): Promise<AuthStatus>
```

## 类型定义

### 核心类型引用

```typescript
// 引用 @modelcontextprotocol/sdk 的类型
import type {
  Tool as MCPTool,
  Resource as MCPResource,
  Prompt as MCPPrompt,
} from '@modelcontextprotocol/sdk/types.js';

// 引用 primo-agent 现有 Tool 类型
import type { Tool } from '../types.js';
```

### McpResource 和 McpPrompt

```typescript
// 包装 MCP SDK 类型，添加客户端信息
interface McpResource {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
  client: string; // 服务器名称
}

interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  client: string; // 服务器名称
}
```

## 配置类型

### McpServerConfig Zod Schema

```typescript
import { z } from 'zod';

const McpLocalConfigSchema = z.object({
  type: z.literal('local'),
  command: z.array(z.string()).min(1, 'Command is required'),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
  timeout: z.number().int().positive().optional(),
});

const OAuthConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
});

const McpRemoteConfigSchema = z.object({
  type: z.literal('remote'),
  url: z.string().url('Invalid URL format'),
  headers: z.record(z.string()).optional(),
  oauth: z.union([z.boolean(), OAuthConfigSchema]).default(true),
  enabled: z.boolean().default(true),
  timeout: z.number().int().positive().optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion('type', [
  McpLocalConfigSchema,
  McpRemoteConfigSchema,
]);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
```

### McpServerConfig

```typescript
type McpServerConfig = McpLocalConfig | McpRemoteConfig;

interface McpLocalConfig {
  type: 'local';
  command: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

interface McpRemoteConfig {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  oauth?: boolean | OAuthConfig;
  enabled?: boolean;
  timeout?: number;
}

interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}
```

## 与 Agent 集成

### 自动集成

Agent 初始化时自动加载 "basic" 组的所有 MCP 工具：

```typescript
const agent = new Agent({
  llm,
  // MCP 工具自动注入
});
```

### 手动集成

```typescript
const mcpTools = await MCP.Toolkit.getTools(['mygroup']);
const agent = new Agent({
  llm,
  tools: [...builtinTools, ...mcpTools],
});
```

## CLI 命令

```bash
primo-agent mcp list                    # 列出所有服务器
primo-agent mcp add <name> <config>    # 添加服务器
primo-agent mcp remove <name>           # 移除服务器
primo-agent mcp connect <name>          # 连接服务器
primo-agent mcp disconnect <name>       # 断开连接
primo-agent mcp auth <name>             # 启动 OAuth 认证
primo-agent mcp tools                   # 列出所有工具
```

## HTTP API 端点

```
GET    /api/mcp              # 获取所有服务器状态
POST   /api/mcp              # 添加服务器
DELETE /api/mcp/:name        # 移除服务器
POST   /api/mcp/:name/connect    # 连接
POST   /api/mcp/:name/disconnect # 断开
POST   /api/mcp/:name/auth       # 启动认证
GET    /api/mcp/tools             # 获取所有工具
```

## 状态类型

```typescript
type McpStatus =
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string };

type AuthStatus = 'authenticated' | 'expired' | 'not_authenticated';
```

## 实现计划

### Phase 1: 核心基础设施

- [ ] 安装 MCP SDK 依赖
- [ ] 创建类型定义 (types.ts)
- [ ] 创建配置管理 (config.ts)

### Phase 2: MCP 客户端

- [ ] 实现传输层 (transport/)
- [ ] 实现客户端管理 (client.ts)
- [ ] 实现工具转换逻辑

### Phase 3: 工具分组

- [ ] 实现 Toolkit 类 (toolkit.ts)
- [ ] 分组激活/停用功能

### Phase 4: OAuth 认证

- [ ] OAuth 提供者 (oauth-provider.ts)
- [ ] OAuth 回调服务器 (oauth-callback.ts)
- [ ] 认证存储 (auth.ts)

### Phase 5: 集成

- [ ] Agent 自动集成
- [ ] CLI 命令 (cli/cmd/mcp.ts)
- [ ] HTTP API (server/routes/mcp.ts)

### Phase 6: 测试和文档

- [ ] 单元测试
- [ ] 集成测试
- [ ] MDX 文档生成

## 错误处理

### 连接错误

| 场景               | 处理方式                                                    |
| ------------------ | ----------------------------------------------------------- |
| 本地进程启动失败   | 记录 stderr 输出，返回 `{ status: 'failed', error: '...' }` |
| 远程服务器连接超时 | 默认 30 秒超时，可配置，返回超时错误                        |
| 认证失败           | 标记为 `needs_auth` 或 `needs_client_registration`          |
| 网络中断           | 自动触发重连机制（最多 3 次，指数退避）                     |

### 工具执行错误

| 场景             | 处理方式                             |
| ---------------- | ------------------------------------ |
| MCP 工具调用失败 | 错误信息通过 ToolResult 返回给 Agent |
| 工具超时         | 可配置超时时间，默认 30 秒           |
| Schema 验证失败  | 在工具转换阶段校验，无效工具跳过     |

### 配置错误

| 场景           | 处理方式                   |
| -------------- | -------------------------- |
| 无效的配置格式 | 抛出明确的 ValidationError |
| 缺少必需字段   | Zod schema 验证失败        |
| 服务器名称冲突 | 覆盖或报错（可配置策略）   |

## 与 Agent 集成详情

### 自动集成机制

Agent 构造函数中自动注入 MCP 工具：

```typescript
// 在 Agent 构造函数中
constructor(options: AgentOptions) {
  this.llm = options.llm;
  this.tools = [
    ...(options.tools || []),
    ...MCP.Toolkit.getTools(['basic']) // 自动注入 basic 组
  ];
}
```

### 工具执行流程

1. Agent 调用 MCP 工具
2. 工具执行函数调用对应 MCP 客户端的 `callTool()`
3. 结果转换为字符串格式返回给 Agent
4. 错误通过 ToolResult 的 result 字段传递

### "basic" 组定义

默认情况下，"basic" 组包含：

- 所有配置中 `enabled: true` 的服务器的工具
- 用户可通过 `MCP.Toolkit.removeFromBasic(serverName)` 排除特定服务器

#### "basic" 组填充逻辑

1. **服务器连接时**：成功连接后自动将该服务器的所有工具添加到 "basic" 组
2. **服务器断开时**：自动从 "basic" 组移除该服务器的工具
3. **初始加载时**：从配置文件加载所有 `enabled: true` 的服务器并连接，工具自动进入 "basic" 组

#### Toolkit API 补充

```typescript
// 从 basic 组排除特定服务器
MCP.Toolkit.removeFromBasic(serverName: string): void

// 恢复服务器到 basic 组
MCP.Toolkit.addToBasic(serverName: string): void
```

## 边缘情况处理

### 大量工具处理

- 单个服务器返回 > 100 个工具时，记录警告
- 工具名称冲突时自动添加序号后缀：`server_tool`, `server_tool_2`

### 资源和提示访问

- 资源读取失败：返回 `undefined` 并记录错误
- 提示获取失败：返回 `undefined` 并记录错误
- 不中断 Agent 执行流程

### 重连逻辑

```typescript
// 重连策略
maxRetries: 3;
retryDelay: (attempt) => Math.pow(2, attempt) * 1000; // 指数退避
```

连接丢失时自动触发，重连成功后重新获取工具列表。

## 配置文件示例

### mcp.config.json

```json
{
  "version": "1",
  "servers": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "enabled": true
    },
    "github": {
      "type": "remote",
      "url": "https://mcp.github.com",
      "oauth": {
        "clientId": "xxx",
        "scope": "repo,user"
      },
      "enabled": true
    },
    "disabled-server": {
      "type": "local",
      "command": ["some-command"],
      "enabled": false
    }
  }
}
```

### 环境变量配置

```bash
# 单个服务器配置
MCP_SERVERS_MYSERVER_TYPE=local
MCP_SERVERS_MYSERVER_COMMAND='["node", "server.js"]'
MCP_SERVERS_MYSERVER_ENABLED=true

# 多个服务器用 JSON
MCP_SERVERS='{"server1":{"type":"local",...}}'
```

## 数据持久化

### OAuth 令牌存储

- **存储位置**: `~/.primo-agent/mcp-auth.json`
- **加密**: 使用系统密钥链（如可用），否则使用 AES-256
- **内容**:
  ```json
  {
    "servers": {
      "github": {
        "tokens": {
          "access_token": "xxx",
          "refresh_token": "xxx",
          "expires_at": 1234567890
        },
        "client_info": {...}
      }
    }
  }
  ```

### 服务器配置存储

- **优先级**: 代码配置 > 配置文件 > 环境变量
- **配置文件路径**: `./mcp.config.json` 或 `~/.primo-agent/mcp.config.json`

## 风险和注意事项

1. **依赖管理**: 确保 `@modelcontextprotocol/sdk` 正确安装
2. **向后兼容**: 保持现有 API 不受影响
3. **错误处理**: 完善的连接失败和超时处理
4. **安全性**: OAuth 令牌安全存储
