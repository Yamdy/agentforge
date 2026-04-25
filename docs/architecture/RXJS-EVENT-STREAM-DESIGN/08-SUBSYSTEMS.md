# 子系统扩展

> 本文档定义 AgentForge 的子系统扩展模型，包括 SubAgent 委托、MCP 工具、Workflow 编排和 Skill 知识包的统一处理。

---

## 核心问题：嵌套 Observable

Agent Loop 执行 `tool.call` 时，可能是：

- **本地工具**: 同步执行 `tool.execute(args)`
- **Subagent 委托**: 嵌套的 `Observable<AgentEvent>`
- **MCP 工具**: 远程 JSON-RPC 调用

三种模式需要统一为事件流。

---

## 统一模型：嵌套流展平

```typescript
private handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): Observable<AgentEvent> {
  const call = event as Extract<AgentEvent, { type: 'tool.call' }>;

  // 1. Subagent 委托
  if (ctx.subagents?.has(call.toolName)) {
    return concat(
      // Layer 2 事件：subagent 生命周期
      of({
        type: 'subagent.start',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        subagentName: call.toolName,
        input: call.args,
      }),

      // 嵌套流：所有事件冒泡到父级（带上下文标记）
      ctx.subagents.run(call.toolName, call.args.input).pipe(
        map((e) => ({
          ...e,
          // 标记来源，用于追溯
          parentId: call.toolCallId,
          parentSessionId: ctx.sessionId,
        })),
      ),

      // Layer 2 事件：subagent 完成
      of({
        type: 'subagent.complete',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        subagentName: call.toolName,
        output: '...', // 从嵌套流的最后事件获取
      }),
    );
  }

  // 2. MCP 工具
  if (ctx.mcp && isMcpTool(call.toolName)) {
    return concat(
      of({ type: 'tool.execute', ...call }),

      // MCP 调用（可能超时）
      defer(() => ctx.mcp!.callTool(call.toolName, call.args)).pipe(
        timeout(ctx.mcp!.options?.timeout ?? 30000),
        map((result) => ({
          type: 'tool.result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result,
          isError: false,
        })),
        catchError((error) => of({
          type: 'tool.error',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error,
        })),
      ),
    );
  }

  // 3. 本地工具
  return concat(
    of({ type: 'tool.execute', ...call }),

    defer(() => ctx.tools.execute(call.toolName, call.args)).pipe(
      // 流式工具结果（如 bash 长输出）
      mergeMap((result) => {
        if (typeof result === 'string') {
          return of({
            type: 'tool.result',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            result,
          });
        }
        // 如果工具返回 Observable，逐块发送
        if (result instanceof Observable) {
          return result.pipe(
            map((chunk) => ({
              type: 'tool.result.delta',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              delta: chunk,
            })),
            // 最后发送完整结果
            last(),
            map((final) => ({
              type: 'tool.result',
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              result: final,
            })),
          );
        }
        return of({
          type: 'tool.result',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          result: JSON.stringify(result),
        });
      }),
      catchError((error) => of({
        type: 'tool.error',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
      })),
    ),
  );
}
```

---

## Workflow 作为高层抽象

Workflow 不是 Agent Loop 内部机制，而是 Agent 之上的编排层。每个 step 内部调用 `agent.run()`，事件冒泡到顶层。

```typescript
// Workflow 执行时的事件流
const workflow$ = workflow.run({ topic: 'AI' }).pipe(
  // 过滤 workflow 层事件 + 嵌套的 agent 事件
  filter((e) => e.type.startsWith('workflow.') || e.type.startsWith('agent.')),
  tap(tracer.record),
);

// Workflow step 内部
class WorkflowExecutor {
  async executeStep(step: WorkflowStep, input: unknown): Promise<unknown> {
    // 发出 workflow.step.start 事件
    this.emit({ type: 'workflow.step.start', stepId: step.id, input });

    // 调用 Agent（嵌套流）
    const result = await firstValueFrom(
      this.agent.run(step.prompt(input)).pipe(
        filter((e) => e.type === 'agent.complete'),
        map((e) => e.output),
      ),
    );

    // 发出 workflow.step.end 事件
    this.emit({ type: 'workflow.step.end', stepId: step.id, output: result });

    return result;
  }
}
```

---

## Skill 作为知识包

> ⚠️ **重要修正**：Skill 不是"执行子系统"，也不是"Tool 包装"。Skill 是**可复用的知识包**，提供领域特定指令和工作流模板。

### 行业标准定义

经过对 Semantic Kernel、CrewAI、LangChain、PraisonAI 等框架的研究，行业共识为：

| 框架 | Skill 定义 |
|------|-----------|
| **Semantic Kernel** | 改名为 **Plugin** = 函数集合，是 Tool 分组 |
| **CrewAI** | **Prompt 注入** = markdown 指令，修正 Agent 行为 |
| **LangChain** | **动态加载的专家知识**，通过 `load_skill` 工具访问 |
| **PraisonAI/Qwen-Code** | **SKILL.md 知识包**，静态文件 + frontmatter |

**核心共识**：Skill 是**知识载体**，不执行代码，不编排流程。

### 正确的层次定位

```
┌─────────────────────────────────────────────────────────────────┐
│                          AGENT                                  │
│                    (目标驱动的编排器)                            │
│   - 理解目标，规划步骤                                           │
│   - 调用工具执行操作                                             │
│   - 加载技能获取知识                                             │
│   - 委托子代理处理子任务                                         │
└─────────────────────────────────────────────────────────────────┘
                  │                    │                    │
         ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
         ▼                 ▼  ▼                 ▼  ▼                 ▼
    ┌─────────┐      ┌──────────┐      ┌─────────────┐
    │  TOOL   │      │  SKILL   │      │  SUBAGENT   │
    │ 原子操作 │      │ 知识包    │      │ 子代理      │
    ├─────────┤      ├──────────┤      ├─────────────┤
    │ 可执行   │      │ 静态文件  │      │ 嵌套 Agent  │
    │ 确定性   │      │ 指导性    │      │ 可递归      │
    │ 无状态   │      │ 按需加载  │      │ 独立上下文  │
    └─────────┘      └──────────┘      └─────────────┘

关键区别：
- Tool 是「手」：执行具体操作
- Skill 是「脑的知识」：指导如何使用手（引用 Tool 在其指令中）
- SubAgent 是「助手」：能独立完成子任务（有 LLM，可执行）
```

### Skill 接口定义

```typescript
// src/skill/types.ts

/** Skill 元数据（来自 SKILL.md frontmatter） */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  version: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  
  /** 允许使用的工具（可选约束） */
  allowedTools: z.array(z.string()).optional(),
  
  /** 触发关键词（用于自动发现） */
  triggers: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  
  /** 兼容性标记 */
  compatibility: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Skill 完整信息 */
export interface SkillInfo {
  frontmatter: SkillFrontmatter;
  /** SKILL.md 的 Markdown 内容（指令部分） */
  content: string;
  /** 文件路径 */
  location: string;
  /** 最后更新时间 */
  updatedAt: Date;
}
```

### Skill 文件格式（行业标准）

采用 Anthropic 定义的 **SKILL.md** 格式：

```markdown
---
name: git-release
description: Create consistent git releases with changelogs
version: "1.0"
author: agentforge-team
license: MIT
allowed-tools:
  - bash
  - read
  - write
triggers:
  - release
  - changelog
keywords:
  - git
  - version
  - semver
---

# Git Release Skill

## 工作流程

当创建一个新版本发布时：

1. **验证版本号**
   - 使用 `read` 工具检查 package.json 中的版本
   - 确保版本号符合 semver 规范

2. **生成变更日志**
   - 使用 `bash` 工具运行 `git log --oneline v<prev>..HEAD`
   - 按类型分类变更（feat/fix/docs/refactor）

3. **创建标签**
   - 使用 `bash` 工具运行 `git tag -a v<version> -m "..."`
   - 推送标签到远程

4. **更新 CHANGELOG.md**
   - 使用 `write` 工具更新变更日志文件

## 注意事项

- 遵循 Conventional Commits 规范
- 检查是否有未提交的更改
- 确保所有测试通过
```

---

## 事件冒泡规则

| 子系统事件 | 冒泡行为 |
|----------|---------|
| `agent.*` (嵌套) | 直接冒泡，加 `parentSessionId` |
| `subagent.*` | 在嵌套 agent 事件外层包裹 |
| `mcp.*` | 不冒泡，仅在 MCP 客户端内部 |
| `workflow.*` | 直接冒泡，嵌套的 agent 事件加 `workflowId` |
| `skill.*` | 不产生事件流事件；加载结果注入 Agent 上下文 |
| `compaction.*` | 不冒泡，内部操作 |
| `permission.*` | 不冒泡，内部操作（但可通过 HITL 暴露） |

> ⚠️ **注意**：Skill 不是执行子系统，不产生低延迟事件流事件。`load_skill` 工具的返回是同步的知识内容注入。

---

## MCP Client 设计

> 基于 `@modelcontextprotocol/sdk` 官方 SDK，遵循行业最佳实践。

### 设计决策

经过对 Mastra、OpenCode、DeepAgents、AgentScope、OpenHarness 等框架的分析，**所有框架都使用官方 `@modelcontextprotocol/sdk`**。

**为什么使用官方 SDK？**

| 对比项 | 自定义实现 | 官方 SDK |
|--------|-----------|----------|
| 协议兼容性 | 需手动跟进规范更新 | 自动兼容最新规范 |
| 传输层可靠性 | 需处理边界情况 | 已经过生产验证 |
| 维护成本 | 高（~300 行代码） | 低（~50 行包装） |
| 社区支持 | 无 | 完整文档 + 社区 |

### 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      AgentForge MCP Client                       │
├─────────────────────────────────────────────────────────────────┤
│  MCPSDKClient (wrapper)                                          │
│  ├── connect()                                                   │
│  ├── tools(): Promise<MCPToolInfo[]>                            │
│  ├── callTool(name, args): Promise<string>                      │
│  ├── resources(): Promise<MCPResourceInfo[]>                    │
│  ├── prompts(): Promise<MCPPromptInfo[]>                        │
│  └── disconnect()                                                │
├─────────────────────────────────────────────────────────────────┤
│  @modelcontextprotocol/sdk (官方 SDK)                            │
│  ├── Client (核心客户端)                                         │
│  ├── StdioClientTransport (本地进程通信)                         │
│  ├── StreamableHTTPClientTransport (HTTP + SSE)                 │
│  └── SSEClientTransport (传统 SSE)                               │
└─────────────────────────────────────────────────────────────────┘
```

### 接口定义

```typescript
// src/core/interfaces.ts

/** MCP 连接状态 */
export type MCPStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/** MCP 工具定义 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP 服务器配置 */
export interface MCPServerConfig {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** MCP 客户端接口 */
export interface MCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  tools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
  status(): MCPStatus;
  onStatusChange(): Observable<MCPStatus>;
}
```

### MCPSDKClient 实现

```typescript
// src/mcp/sdk-client.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from '../core/interfaces.js';
import type { JSONSchema7 } from 'json-schema';

/** MCP 工具信息 */
export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema: JSONSchema7;
}

/** MCP 资源信息 */
export interface MCPResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** MCP 提示词信息 */
export interface MCPPromptInfo {
  name: string;
  description?: string;
}

/**
 * MCP Client using official @modelcontextprotocol/sdk
 *
 * 使用方式：
 * 1. 创建客户端实例
 * 2. 调用 connect() 连接到 MCP 服务器
 * 3. 使用 tools() / callTool() / resources() / prompts() 与服务器交互
 * 4. 使用完毕后调用 disconnect() 断开连接
 */
export class MCPSDKClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | undefined;
  private _connected = false;

  constructor(
    private config: MCPServerConfig,
    private options: MCPSDKClientOptions
  ) {}

  async connect(): Promise<void> {
    if (this._connected) return;

    this.emitEvent({ type: 'mcp.connecting' });

    try {
      // 根据配置类型创建传输层
      if (this.config.type === 'stdio') {
        const command = this.config.command;
        if (!command) {
          throw new Error('MCP stdio config requires "command" field');
        }
        const transportOptions: { command: string; args: string[]; env?: Record<string, string> } = {
          command,
          args: this.config.args ?? [],
        };
        if (this.config.env) {
          transportOptions.env = this.config.env;
        }
        this.transport = new StdioClientTransport(transportOptions);
      } else if (this.config.type === 'http') {
        const url = this.config.url;
        if (!url) {
          throw new Error('MCP http config requires "url" field');
        }
        this.transport = new StreamableHTTPClientTransport(new URL(url));
      } else {
        // SSE fallback
        const url = this.config.url;
        if (!url) {
          throw new Error('MCP sse config requires "url" field');
        }
        this.transport = new SSEClientTransport(new URL(url));
      }

      // 创建客户端并连接
      this.client = new Client(
        { name: 'agentforge', version: '0.1.0' },
        { capabilities: {} }
      );

      await this.client.connect(this.transport as Parameters<Client['connect']>[0]);
      this._connected = true;

      this.emitEvent({ type: 'mcp.connected' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitEvent({ type: 'mcp.error', error: message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this._connected) {
      await this.client.close();
      this._connected = false;
      this.emitEvent({ type: 'mcp.disconnected' });
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  async tools(): Promise<MCPToolInfo[]> {
    this.ensureConnected();

    const result = await this.client!.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema
    );

    return result.tools.map(tool => {
      const info: MCPToolInfo = {
        name: tool.name,
        inputSchema: tool.inputSchema as JSONSchema7,
      };
      if (tool.description) {
        info.description = tool.description;
      }
      return info;
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    this.ensureConnected();

    const result = await this.client!.request(
      { method: 'tools/call', params: { name, arguments: args } },
      CallToolResultSchema
    );

    // 从结果中提取文本内容
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content
        .filter(c => c.type === 'text')
        .map(c => (c as { text: string }).text)
        .join('\n');
      return textContent || JSON.stringify(result.content);
    }

    return JSON.stringify(result);
  }

  async resources(): Promise<MCPResourceInfo[]> {
    this.ensureConnected();

    try {
      const result = await this.client!.request(
        { method: 'resources/list', params: {} },
        ListResourcesResultSchema
      );

      return result.resources.map(res => {
        const info: MCPResourceInfo = {
          uri: res.uri,
          name: res.name,
        };
        if (res.description) {
          info.description = res.description;
        }
        if (res.mimeType) {
          info.mimeType = res.mimeType;
        }
        return info;
      });
    } catch {
      return [];
    }
  }

  async prompts(): Promise<MCPPromptInfo[]> {
    this.ensureConnected();

    try {
      const result = await this.client!.request(
        { method: 'prompts/list', params: {} },
        ListPromptsResultSchema
      );

      return result.prompts.map(p => {
        const info: MCPPromptInfo = {
          name: p.name,
        };
        if (p.description) {
          info.description = p.description;
        }
        return info;
      });
    } catch {
      return [];
    }
  }

  private ensureConnected(): void {
    if (!this._connected || !this.client) {
      throw new Error('MCP client not connected. Call connect() first.');
    }
  }

  private emitEvent(event: Partial<MCPEvent>): void {
    if (this.options.emitEvent) {
      this.options.emitEvent({
        type: event.type ?? 'mcp.event',
        timestamp: Date.now(),
        sessionId: this.options.sessionId,
        serverName: this.options.serverName,
        ...event,
      });
    }
  }
}

/** 创建 MCP SDK 客户端的工厂函数 */
export function createMCPSDKClient(
  config: MCPServerConfig,
  options: MCPSDKClientOptions
): MCPSDKClient {
  return new MCPSDKClient(config, options);
}
```

### 使用示例

```typescript
// 连接到本地 MCP 服务器
const client = createMCPSDKClient(
  {
    name: 'everything',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  },
  {
    serverName: 'everything',
    sessionId: 'test-session',
    emitEvent: (event) => console.log('[MCP Event]', event.type),
  }
);

await client.connect();

// 获取工具列表
const tools = await client.tools();
console.log('Available tools:', tools.map(t => t.name));

// 调用工具
const result = await client.callTool('echo', { message: 'Hello!' });
console.log('Result:', result);

// 断开连接
await client.disconnect();
```

### 支持的传输类型

| 类型 | 使用场景 | 示例 |
|------|---------|------|
| **stdio** | 本地 MCP 服务器进程 | `npx @modelcontextprotocol/server-filesystem` |
| **http** | 支持 Streamable HTTP 的远程服务器 | `https://api.example.com/mcp` |
| **sse** | 传统 SSE 远程服务器 | `https://api.example.com/sse` |

### 与 Agent Loop 集成

```typescript
// 在 agent-loop.ts 的 handleToolCall 中添加 MCP 路由

private handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): Observable<AgentEvent> {
  const call = event as Extract<AgentEvent, { type: 'tool.call' }>;

  // 1. SubAgent 委托
  if (ctx.subagents?.has(call.toolName)) {
    return this.handleSubAgentDelegation(call, state, ctx);
  }

  // 2. MCP 工具路由
  if (ctx.mcp && this.isMcpTool(ctx.mcp, call.toolName)) {
    return this.handleMcpTool(call, state, ctx);
  }

  // 3. 本地工具
  return this.handleLocalTool(call, state, ctx);
}

private isMcpTool(mcp: MCPClient, toolName: string): boolean {
  // MCP 工具名格式：mcp_<server>_<tool>
  return toolName.startsWith('mcp_');
}

private handleMcpTool(
  call: ToolCallEvent,
  state: AgentState,
  ctx: AgentContext
): Observable<AgentEvent> {
  return concat(
    of({ type: 'tool.execute', ...call }),

    defer(() => ctx.mcp!.callTool(call.toolName, call.args)).pipe(
      timeout(30000),
      map((result) => ({
        type: 'tool.result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result,
        isError: false,
      })),
      catchError((error) =>
        of({
          type: 'tool.error',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error: serializeError(error),
        })
      ),
    ),
  );
}
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - SubAgent/MCP/Workflow/Skill 子系统 |
| v2 | 2026-04-26 | 补充 MCP Client 传输层详细设计 (Stdio/HTTP) |
| v3 | 2026-04-26 | **重构**: 使用官方 `@modelcontextprotocol/sdk` 替代自定义实现，简化架构 |
