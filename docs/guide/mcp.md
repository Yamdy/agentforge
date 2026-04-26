# MCP 协议

AgentForge 支持模型上下文协议（Model Context Protocol，MCP），允许 Agent 连接和使用外部工具服务器。

## 概述

MCP 是一个开放协议，用于连接 AI 助手和外部数据源/工具。AgentForge 实现了 MCP 规范，支持：

- **STDIO Transport**：通过标准输入/输出与本地进程通信
- **HTTP Transport**：通过 HTTP 与远程服务通信
- **SSE Transport**：通过 Server-Sent Events 进行实时通信

## 基本使用

### 创建 MCP 客户端

```typescript
import { createMCPClient } from 'agentforge';

const mcpClient = createMCPClient(
  {
    name: 'filesystem-server',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
  {
    serverName: 'filesystem',
    sessionId: 'session-123',
  }
);
```

### 连接和断开

```typescript
// 连接到 MCP 服务器
await mcpClient.connect();

// 检查连接状态
console.log(mcpClient.status()); // 'connected'

// 获取可用工具
const tools = await mcpClient.tools();
console.log('Available tools:', tools.map(t => t.name));

// 断开连接
await mcpClient.disconnect();
```

### 调用工具

```typescript
// 调用 MCP 工具
const result = await mcpClient.callTool('read_file', {
  path: '/tmp/test.txt',
});
console.log('File contents:', result);
```

## MCP 服务器配置

### STDIO 传输

```typescript
const stdioConfig: MCPServerConfig = {
  name: 'local-server',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: {
    NODE_ENV: 'production',
  },
};
```

### HTTP 传输

```typescript
const httpConfig: MCPServerConfig = {
  name: 'remote-server',
  type: 'http',
  url: 'https://api.example.com/mcp',
};
```

### SSE 传输

```typescript
const sseConfig: MCPServerConfig = {
  name: 'sse-server',
  type: 'sse',
  url: 'https://api.example.com/mcp/sse',
};
```

## MCP 事件

MCP 客户端发出生命周期事件：

```typescript
// 订阅状态变更
mcpClient.onStatusChange().subscribe(status => {
  console.log('MCP status:', status);
  // 'connecting' → 'connected' → 'disconnected'
});

// 通过 AgentContext 发出的事件
mcpClient = createMCPClient(config, {
  serverName: 'filesystem',
  sessionId: 'session-123',
  emitEvent: (event) => {
    if (event.type === 'mcp.connected') {
      console.log('Connected, tools:', event.tools);
    }
    if (event.type === 'mcp.error') {
      console.error('Error:', event.error.message);
    }
    if (event.type === 'mcp.tools_changed') {
      console.log('Tools changed:', event.added, event.removed);
    }
  },
});
```

### 事件类型

| 事件类型 | 说明 |
|---------|------|
| `mcp.connecting` | 正在连接服务器 |
| `mcp.connected` | 连接成功 |
| `mcp.disconnected` | 连接断开 |
| `mcp.tools_changed` | 工具列表变更 |
| `mcp.error` | 错误发生 |

## 工具适配

将 MCP 工具适配为 AgentForge 工具：

```typescript
import { MCPToolAdapter } from 'agentforge';

// 创建适配器
const adapter = new MCPToolAdapter(mcpClient);

// 获取适配后的工具定义
const adaptedTools = await adapter.getTools();

// 这些工具可以直接注册到 ToolRegistry
registry.registerAll(adaptedTools);
```

## 在 Agent 中使用

将 MCP 客户端集成到 Agent：

```typescript
import { ContextBuilder } from 'agentforge';

// 创建 MCP 客户端
const filesystemMCP = createMCPClient(
  { name: 'filesystem', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
  { serverName: 'filesystem', sessionId: 'session-123' }
);

// 连接
await filesystemMCP.connect();

// 创建上下文
const ctx = ContextBuilder.create()
  .withLLM(myLLMAdapter)
  .withMCP(filesystemMCP)  // 添加 MCP 客户端
  .build();

// Agent 自动获取 MCP 工具
const agent = createAgent({
  name: 'file-assistant',
  model: 'openai/gpt-4o',
  mcp: [filesystemMCP],
});
```

## 错误处理

MCP 错误通过事件报告，不会抛出异常：

```typescript
mcpClient.callTool('invalid_tool', {})
  .then(result => console.log(result))
  .catch(error => {
    // MCP 错误会在这里捕获
    console.error('Tool call failed:', error.message);
  });
```

## 超时配置

```typescript
const client = createMCPClient(config, {
  serverName: 'slow-server',
  sessionId: 'session-123',
  timeout: 60000, // 60 秒超时
});
```

## 常见 MCP 服务器

| 服务器 | 说明 | 安装 |
|--------|------|------|
| `@modelcontextprotocol/server-filesystem` | 文件系统操作 | `npx -y @modelcontextprotocol/server-filesystem /path` |
| `@modelcontextprotocol/server-github` | GitHub API | `npx -y @modelcontextprotocol/server-github` |
| `@modelcontextprotocol/server-postgres` | PostgreSQL | `npx -y @modelcontextprotocol/server-postgres` |
| `@modelcontextprotocol/server-slack` | Slack 集成 | `npx -y @modelcontextprotocol/server-slack` |

## 相关 API

- [MCPClient 接口](/api/llm-adapter) - MCP 客户端接口
- [事件系统](/guide/events) - mcp.* 事件类型
- [工具系统](/guide/tools) - 工具定义