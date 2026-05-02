# 子系统扩展

> 本文档定义 AgentForge 的子系统扩展模型，包括 SubAgent 委托、MCP 工具、Workflow 编排和 Skill 知识包的统一处理。

---

## 核心问题：嵌套执行

Agent Loop 执行 `tool.call` 时，可能是：

- **本地工具**: 同步执行 `tool.execute(args)`
- **Subagent 委托**: 嵌套的 Agent 执行
- **MCP 工具**: 远程 JSON-RPC 调用

三种模式通过统一的事件循环模型处理。

---

## 统一模型：嵌套执行

```typescript
async function* handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): AsyncGenerator<AgentEvent> {
  const call = event as Extract<AgentEvent, { type: 'tool.call' }>;

  // 1. Subagent 委托
  if (ctx.subagents?.has(call.toolName)) {
    // Layer 2 事件：subagent 生命周期
    yield {
      type: 'subagent.start',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      subagentName: call.toolName,
      input: call.args,
    };

    // 嵌套执行：所有事件冒泡到父级（带上下文标记）
    for await (const e of ctx.subagents.run(call.toolName, call.args.input)) {
      yield {
        ...e,
        parentId: call.toolCallId,
        parentSessionId: ctx.sessionId,
      };
    }

    // Layer 2 事件：subagent 完成
    yield {
      type: 'subagent.complete',
      timestamp: Date.now(),
      sessionId: ctx.sessionId,
      subagentName: call.toolName,
      output: '...', // 从嵌套执行的最后事件获取
    };
    return;
  }

  // 2. MCP 工具
  if (ctx.mcp && isMcpTool(call.toolName)) {
    yield { type: 'tool.execute', ...call };

    try {
      // MCP 调用（可能超时）
      const result = await ctx.mcp!.callTool(call.toolName, call.args);
      yield {
        type: 'tool.result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result,
        isError: false,
      };
    } catch (error) {
      yield {
        type: 'tool.error',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        error,
      };
    }
    return;
  }

  // 3. 本地工具
  yield { type: 'tool.execute', ...call };

  try {
    const result = await ctx.tools.execute(call.toolName, call.args);
    yield {
      type: 'tool.result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result: typeof result === 'string' ? result : JSON.stringify(result),
    };
  } catch (error) {
    yield {
      type: 'tool.error',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      error,
    };
  }
}
```

---

## Workflow 作为高层抽象

Workflow 不是 Agent Loop 内部机制，而是 Agent 之上的编排层。每个 step 内部调用 `agent.run()`，事件冒泡到顶层。

```typescript
// Workflow 执行时监听事件
workflow.on('event', (e) => {
  // 过滤 workflow 层事件 + 嵌套的 agent 事件
  if (e.type.startsWith('workflow.') || e.type.startsWith('agent.')) {
    tracer.record(e);
  }
});

// Workflow step 内部
class WorkflowExecutor {
  async executeStep(step: WorkflowStep, input: unknown): Promise<unknown> {
    // 发出 workflow.step.start 事件
    this.emit({ type: 'workflow.step.start', stepId: step.id, input });

    // 调用 Agent（嵌套执行）
    const result = await this.agent.run(step.prompt(input));
    // 从结果中提取输出

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
| `skill.*` | 不产生事件循环事件；加载结果注入 Agent 上下文 |
| `compaction.*` | 不冒泡，内部操作 |
| `permission.*` | 不冒泡，内部操作（但可通过 HITL 暴露） |

> ⚠️ **注意**：Skill 不是执行子系统，不产生低延迟事件循环事件。`load_skill` 工具的返回是同步的知识内容注入。

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
  onStatusChange(handler: (status: MCPStatus) => void): () => void;
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

private async handleToolCall(event: AgentEvent, state: AgentState, ctx: AgentContext): AsyncGenerator<AgentEvent> {
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

private async handleMcpTool(
  call: ToolCallEvent,
  state: AgentState,
  ctx: AgentContext
): AsyncGenerator<AgentEvent> {
  yield { type: 'tool.execute', ...call };

  try {
    const result = await ctx.mcp!.callTool(call.toolName, call.args);
    yield {
      type: 'tool.result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result,
      isError: false,
    };
  } catch (error) {
    yield {
      type: 'tool.error',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      error: serializeError(error),
    };
  }
}
```

---

## 规划/执行分离架构 (P1)

> 基于 LangGraph Plan-Execute、AgentScope PlanNotebook、Mastra Workflow 的设计模式，实现规划与执行分离，从根源避免上下文耗尽与盲目试错。

### 设计动机

当前 AgentForge 的 while(true) 递归模式：
- ❌ 无全局规划：每一步都是局部决策
- ❌ 上下文爆炸：长任务导致 token 耗尽
- ❌ 盲目重试：失败后无指导性重试
- ❌ 无进度追踪：用户无法了解任务进展

### 核心模型

```typescript
/** 规划步骤 */
interface PlanStep {
  id: string;
  description: string;
  expectedOutcome?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  dependencies?: string[];  // DAG 依赖
}

/** 规划状态 */
interface PlanState {
  planId: string;
  steps: PlanStep[];
  currentStepIndex: number;
  stepResults: Map<string, unknown>;
  replanCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 决策链追踪 */
interface DecisionChain {
  planId: string;
  stepId: string;
  decisionType: 'tool_selection' | 'completion' | 'replan' | 'skip';
  rationale: string;
  alternatives?: string[];
  confidence?: number;
}
```

### 三种集成模式

#### 模式 A: 预规划模式 (Pre-Planning)

```typescript
// 在循环开始前生成完整计划
async function* runWithPlan(input: string, ctx: AgentContext): AsyncGenerator<AgentEvent> {
  // Phase 1: 规划 (单次 LLM 调用)
  const plan = await createPlan(input, ctx);
  yield { type: 'plan.created', plan, sessionId: ctx.sessionId };

  // Phase 2: 按计划执行步骤
  for await (const event of executePlanSteps(plan, ctx)) {
    yield event;
  }
}

// 执行计划步骤 (顺序)
async function* executePlanSteps(plan: PlanState, ctx: AgentContext): AsyncGenerator<AgentEvent> {
  for (const [index, step] of plan.steps.entries()) {
    if (step.status === 'skipped') continue;

    yield { type: 'plan.step.start', stepId: step.id, stepIndex: index };
    // 每个 step 是独立的 AgentLoop (有 maxSteps 限制)
    for await (const event of await createAgentLoop(ctx, { maxSteps: 5 }).run(step.description)) {
      yield event;
      if (event.type === 'agent.complete') {
        plan.stepResults.set(step.id, event.output);
      }
    }
    yield { type: 'plan.step.complete', stepId: step.id };
  }
}
```

#### 模式 B: Agent 自管理模式 (Agent-Managed Planning)

```typescript
// 参考 AgentScope PlanNotebook: 计划工具注册到 ToolRegistry
class PlanNotebook {
  private plan: PlanState | null = null;
  
  /** 注册计划管理工具 */
  registerTools(registry: ToolRegistry): void {
    registry.register({
      name: 'create_plan',
      description: '为复杂任务创建结构化计划',
      parameters: PlanCreateSchema,
      execute: async (params) => {
        this.plan = this.createPlanFromParams(params);
        return `计划已创建，共 ${this.plan.steps.length} 个步骤`;
      },
    });
    
    registry.register({
      name: 'finish_subtask',
      description: '标记当前步骤完成，自动激活下一步',
      parameters: z.object({ subtaskIndex: z.number(), outcome: z.string() }),
      execute: async (params) => {
        this.plan.steps[params.subtaskIndex].status = 'completed';
        // 自动激活下一步
        if (params.subtaskIndex < this.plan.steps.length - 1) {
          this.plan.steps[params.subtaskIndex + 1].status = 'in_progress';
        }
        return `步骤 ${params.subtaskIndex} 已完成`;
      },
    });
    
    registry.register({
      name: 'revise_plan',
      description: '基于新信息修订计划',
      parameters: z.object({ reason: z.string(), newSteps: z.array(z.string()) }),
      execute: async (params) => {
        this.plan = this.replan(params.reason, params.newSteps);
        return `计划已修订，新计划共 ${this.plan.steps.length} 步`;
      },
    });
  }
  
  /** 获取当前步骤提示 (注入系统消息) */
  getCurrentStepHint(): string | null {
    if (!this.plan) return null;
    const current = this.plan.steps.find(s => s.status === 'in_progress');
    if (!current) return null;
    return `<plan-hint>当前执行: ${current.description}\n预期产出: ${current.expectedOutcome ?? 'N/A'}</plan-hint>`;
  }
}
```

#### 模式 C: 重规划循环模式 (Replan Loop)

```typescript
// 参考 LangGraph Plan-Execute: 执行 → 验证 → 重规划
interface ReplanState {
  plan: PlanState;
  failures: string[];
  replanTriggered: boolean;
}

async function* executeWithReplan(input: string, ctx: AgentContext): AsyncGenerator<AgentEvent> {
  let state: ReplanState = { plan: null, failures: [], replanTriggered: false };
  yield { type: 'plan.create', sessionId: ctx.sessionId };

  while (true) {
    // 终止条件: 所有步骤完成
    if (state.plan && state.plan.currentStepIndex >= state.plan.steps.length) {
      return;
    }
    
    // 规划阶段
    if (!state.plan) {
      const plan = await createPlan(input, ctx);
      state = { ...state, plan };
      yield { type: 'plan.created', sessionId: ctx.sessionId };
      continue;
    }
    
    // 执行步骤
    const step = state.plan.steps[state.plan.currentStepIndex];
    const result = await executeStep(step, ctx);
    yield { type: 'plan.step.executed', result, sessionId: ctx.sessionId };
    
    // 验证步骤结果
    const score = validateStepResult(result, step);
    
    if (score < 0.7) {
      // 失败 → 触发重规划
      state = { ...state, replanTriggered: true, failures: [...state.failures, step.id] };
      yield { type: 'plan.replan.trigger', reason: 'step_failed', score, sessionId: ctx.sessionId };
      
      // 重规划
      const newPlan = await replan(state.plan, state.failures, ctx);
      state = { ...state, plan: newPlan, replanTriggered: false };
      yield { type: 'plan.updated', replanCount: state.plan.replanCount + 1, sessionId: ctx.sessionId };
      continue;
    }
    
    // 成功 → 进入下一步
    yield { type: 'plan.step.complete', sessionId: ctx.sessionId };
    state = { ...state, plan: { ...state.plan, currentStepIndex: state.plan.currentStepIndex + 1 } };
  }
}
```

### 事件类型扩展

```typescript
// 新增事件类型 (AgentEventTypeSchema)
'plan.created',
'plan.updated',
'plan.step.start',
'plan.step.executed',
'plan.step.complete',
'plan.step.failed',
'plan.replan.trigger',
'plan.completed',
```

### 与现有架构的兼容性

| 兼容点 | 当前设计 | 规划模式整合 |
|--------|---------|-------------|
| **状态不可变** | `AgentState` 通过闭包传递 | `PlanState` 同样不可变，每次更新返回新对象 |
| **错误即事件** | 失败发 `agent.error` + `done` | 规划失败发 `plan.step.failed`，但不终止流，触发重规划 |
| **嵌套执行** | SubAgent 通过 AsyncGenerator 展平 | 每个 `PlanStep` 是嵌套 `AgentLoop`，事件冒泡 |
| **Checkpoint** | 断点保存完整状态 | `PlanState` 添加到 Checkpoint，支持恢复 |

---

## RAG 检索增强生成 (P2)

> 基于 LangChain Retrieval、LlamaIndex、Mastra RAG 的设计模式，实现知识库检索增强能力。

### 设计动机

Agent 缺少外部知识检索能力：
- ❌ 无长期记忆：无法访问历史对话或文档
- ❌ 无知识库：无法检索领域特定知识
- ❌ 无向量检索：无法进行语义相似度搜索

### 核心接口

```typescript
// src/rag/interfaces.ts

import { z } from 'zod';

/** 文档结构 */
export const DocumentSchema = z.object({
  /** 文档 ID */
  id: z.string(),
  /** 文档内容 */
  content: z.string(),
  /** 元数据 */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** 向量嵌入 (可选，由 VectorStore 生成) */
  embedding: z.array(z.number()).optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

/** 向量存储接口 */
export interface VectorStore {
  /** 添加文档 */
  addDocuments(docs: Document[]): Promise<void>;
  
  /** 相似度搜索 */
  similaritySearch(query: string, k?: number): Promise<Document[]>;
  
  /** 相似度搜索带分数 */
  similaritySearchWithScore(query: string, k?: number): Promise<[Document, number][]>;
  
  /** 删除文档 */
  delete(ids: string[]): Promise<void>;
  
  /** 转换为 Retriever */
  asRetriever(k?: number): Retriever;
}

/** 检索器接口 */
export interface Retriever {
  /** 检索相关文档 */
  retrieve(query: string): Promise<Document[]>;
  
  /** 检索器名称 */
  name: string;
}

/** 嵌入模型接口 */
export interface EmbeddingModel {
  /** 生成文本嵌入向量 */
  embed(text: string): Promise<number[]>;
  
  /** 批量生成嵌入向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

### VectorStore 实现

```typescript
// src/rag/memory-vector-store.ts

/** 内存向量存储 (开发/测试用) */
export class MemoryVectorStore implements VectorStore {
  private documents: Document[] = [];
  
  constructor(private embeddingModel: EmbeddingModel) {}
  
  async addDocuments(docs: Document[]): Promise<void> {
    const embeddings = await this.embeddingModel.embedBatch(
      docs.map(d => d.content)
    );
    
    this.documents.push(
      ...docs.map((doc, i) => ({
        ...doc,
        embedding: embeddings[i],
      }))
    );
  }
  
  async similaritySearch(query: string, k: number = 4): Promise<Document[]> {
    const queryEmbedding = await this.embeddingModel.embed(query);
    
    const scored = this.documents.map(doc => ({
      doc,
      score: this.cosineSimilarity(queryEmbedding, doc.embedding ?? []),
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, k).map(s => s.doc);
  }
  
  async similaritySearchWithScore(
    query: string,
    k: number = 4
  ): Promise<[Document, number][]> {
    const queryEmbedding = await this.embeddingModel.embed(query);
    
    const scored = this.documents.map(doc => ({
      doc,
      score: this.cosineSimilarity(queryEmbedding, doc.embedding ?? []),
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, k).map(s => [s.doc, s.score] as [Document, number]);
  }
  
  async delete(ids: string[]): Promise<void> {
    this.documents = this.documents.filter(d => !ids.includes(d.id));
  }
  
  asRetriever(k: number = 4): Retriever {
    return {
      name: 'memory-retriever',
      retrieve: async (query: string) => this.similaritySearch(query, k),
    };
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

### RAG as Tool

```typescript
// src/rag/rag-tool.ts

/**
 * 创建 RAG 检索工具
 * 
 * 将 RAG 检索能力包装为 Agent 可调用的工具
 */
export function createRAGRetrievalTool(
  retriever: Retriever,
  options: {
    /** 知识库名称 */
    knowledgeBaseName: string;
    /** 返回文档数量 */
    topK?: number;
    /** 是否包含元数据 */
    includeMetadata?: boolean;
  }
): ToolDefinition {
  const { knowledgeBaseName, topK = 4, includeMetadata = false } = options;
  
  return {
    name: `retrieve_from_${knowledgeBaseName}`,
    description: `从 ${knowledgeBaseName} 知识库中检索相关文档`,
    parameters: z.object({
      query: z.string().describe('检索查询语句'),
    }),
    execute: async (args: { query: string }): Promise<string> => {
      const docs = await retriever.retrieve(args.query);
      
      if (docs.length === 0) {
        return `未在 ${knowledgeBaseName} 中找到相关内容`;
      }
      
      const formatted = docs.map((doc, i) => {
        let result = `[${i + 1}] ${doc.content}`;
        if (includeMetadata && doc.metadata) {
          result += `\n    (来源: ${doc.metadata.source ?? 'unknown'})`;
        }
        return result;
      });
      
      return `从 ${knowledgeBaseName} 检索到 ${docs.length} 条相关内容:\n\n${formatted.join('\n\n')}`;
    },
  };
}
```

### 与 Memory 集成

```typescript
// src/rag/memory-rag-integration.ts

/**
 * RAG + Memory 集成
 * 
 * 将检索结果注入到 Agent 的工作记忆中
 */
export class MemoryRAGIntegration {
  constructor(
    private vectorStore: VectorStore,
    private options: {
      /** 是否自动存储对话 */
      autoStoreConversations?: boolean;
      /** 是否注入检索上下文 */
      injectContext?: boolean;
    } = {}
  ) {}
  
  /** 从对话历史构建知识库 */
  async indexConversationHistory(
    sessionId: string,
    messages: Message[]
  ): Promise<void> {
    const docs: Document[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map((m, i) => ({
        id: `${sessionId}-${i}`,
        content: `${m.role}: ${m.content}`,
        metadata: {
          sessionId,
          role: m.role,
          timestamp: m.metadata?.createdAt,
        },
      }));
    
    await this.vectorStore.addDocuments(docs);
  }
  
  /** 检索相关上下文并格式化 */
  async retrieveContext(query: string, topK: number = 3): Promise<string> {
    const docs = await this.vectorStore.similaritySearch(query, topK);
    
    if (docs.length === 0) return '';
    
    return `<retrieved-context>\n${docs.map(d => d.content).join('\n\n')}\n</retrieved-context>`;
  }
  
  /** 创建注入消息 */
  async createInjectionMessage(query: string): Promise<Message | null> {
    const context = await this.retrieveContext(query);
    if (!context) return null;
    
    return {
      role: 'system',
      content: context,
      metadata: { source: 'memory', pinned: false },
    };
  }
}
```

### 外部向量数据库集成

```typescript
// src/rag/pinecone-vector-store.ts (示例)

/** Pinecone 向量存储 */
export class PineconeVectorStore implements VectorStore {
  private index: PineconeIndex;
  
  constructor(
    private client: Pinecone,
    private indexName: string,
    private embeddingModel: EmbeddingModel
  ) {
    this.index = client.index(indexName);
  }
  
  async addDocuments(docs: Document[]): Promise<void> {
    const embeddings = await this.embeddingModel.embedBatch(
      docs.map(d => d.content)
    );
    
    const vectors = docs.map((doc, i) => ({
      id: doc.id,
      values: embeddings[i],
      metadata: {
        content: doc.content,
        ...doc.metadata,
      },
    }));
    
    await this.index.upsert(vectors);
  }
  
  async similaritySearch(query: string, k: number = 4): Promise<Document[]> {
    const queryEmbedding = await this.embeddingModel.embed(query);
    
    const results = await this.index.query({
      vector: queryEmbedding,
      topK: k,
      includeMetadata: true,
    });
    
    return results.matches.map(match => ({
      id: match.id,
      content: (match.metadata?.content as string) ?? '',
      metadata: match.metadata,
      embedding: match.values,
    }));
  }
  
  // ... other methods
}
```

### 使用示例

```typescript
// 1. 创建向量存储
const embeddingModel = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
const vectorStore = new MemoryVectorStore(embeddingModel);

// 2. 索引文档
await vectorStore.addDocuments([
  { id: 'doc-1', content: 'AgentForge 是一个基于事件驱动的 Agent 框架...' },
  { id: 'doc-2', content: '事件循环架构使用 AsyncGenerator 模式...' },
]);

// 3. 创建检索工具
const ragTool = createRAGRetrievalTool(vectorStore.asRetriever(), {
  knowledgeBaseName: 'agentforge-docs',
  topK: 3,
});

// 4. 注册到 Agent
const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  tools: [ragTool],
});
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件循环底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - SubAgent/MCP/Workflow/Skill 子系统 |
| v2 | 2026-04-26 | 补充 MCP Client 传输层详细设计 (Stdio/HTTP) |
| v3 | 2026-04-26 | **重构**: 使用官方 `@modelcontextprotocol/sdk` 替代自定义实现，简化架构 |
| v4 | 2026-04-26 | **P1 新增**: 规划/执行分离架构 - 预规划/Agent自管理/重规划循环三种模式 |
| v5 | 2026-04-26 | **P2 新增**: RAG 检索增强生成 - VectorStore/Retriever/RAG-as-Tool |
