# AgentForge 集成设计方案

> 日期: 2026-05-06
> 目标: 将 AgentForge 从一个"合格的单 Agent 框架"升级为"能构建 OpenCode 级产品的全栈 Agent 开发框架"
> 核心理念: AgentForge = Agent 开发的 Vue —— 核心响应式系统 + 可选的原语层，不绑 UI/不绑存储/不绑通信协议

---

## 一、当前状态总结

### 1.1 已经合格的核心（不动）

| 模块 | 状态 | 行数 | 评价 |
|------|------|------|------|
| Agent Loop | while(true) + 完整退出条件 | 1048 | 生产级 |
| Tool Pipeline | 5 层安全（Hook→Permission→Security→Sandbox→Exec） | 446 | 行业领先 |
| Plugin System | 6 hook 类型 + 11 内置插件 | ~800 | 合格 |
| Event System | 14 事件 + Zod 验证 | ~500 | 合格 |
| Compaction | 6 策略 + PRE/POST 触发 | 730 | 合格 |
| Error Recovery | 4-tier + ErrorCode 枚举 | ~300 | 合格 |
| LLM Adapters | 5 providers + streaming | ~500 | 合格 |
| MCP | client + transport | ~200 | 合格 |
| 测试 | 2487 tests / 115 files | — | 优秀 |

### 1.2 代码存在但未连接的模块

| 模块 | 位置 | 代码量 | 未连接原因 |
|------|------|--------|-----------|
| Workflow Engine | `src/workflow/` | ~800行，5文件 | 缺少 `createStepFromAgent` 桥接 |
| Subagent Registry | `src/subagent/` | ~400行，3文件 | 缺少 `listAsTools()` + agent-loop 注册点 |
| A2A Protocol | `src/a2a/` | ~700行，7文件 | 缺少真实 transport + agent-loop 集成 |
| Session Persistence | `src/storage/` + `src/core/checkpoint.ts` | ~300行 | `CheckpointStorage.load()` 存在但从不在 loop 中调用 |

### 1.3 能力不足的模块

| 模块 | 当前 | 目标 | 差距 |
|------|------|------|------|
| PluginContext | 9 字段 | 14 字段 | 缺 `executeTool`/`getLLM`/`registerTool`/`setState`/`getMemory` |
| Hook 类型 | 6 种 | 10 种 | 缺 `systemPromptHooks`/`llmParamsHooks`/`messageHooks`/`toolExecuteHooks` |
| LifecyclePhase | 10 值扁平混合 | 分层 3 组 | 阻塞型/观察型/恢复型混在一起 |
| Streaming | onChunk 绕过事件 | 通过 emitter | 插件无法订阅 streaming chunks |
| Sub-path Exports | 26 条 | ~6 条 | 全部内部实现暴露 |

---

## 二、设计原则

### 2.1 "框架 vs 产品"边界

```
框架提供（AgentForge 做）:          产品提供（用户做）:
─────────────────────────────      ─────────────────────
createAgent(config)                CLI 入口（yargs/commander）
Plugin 接口 + Hook 注册            TUI 渲染（React/ink/charm）
CheckpointStorage 接口             SQLite 文件路径选择
ToolDefinition 接口                具体工具实现（bash/read/write）
Workflow 原语                      业务流程编排
SubagentRegistry                   Subagent 配置
A2ATransport 接口                  具体 transport（HTTP/gRPC/WS）
AgentEventEmitter                  UI 事件消费
```

### 2.2 集成模式：参考 Mastra/CrewAI/Pi-Mono

| 模式 | 参考 | 核心思想 |
|------|------|---------|
| **Workflow 编排 Agent** | Mastra | `createStepFromAgent()` — Agent 被包装为 Workflow Step |
| **Subagent = Tool** | Mastra | `listAsTools()` — LLM 原生选择，父 Agent 安全 pipeline 仍然生效 |
| **Session = Provider 模式** | CrewAI | `SessionProvider` 接口 — 框架定义，用户选 JSON/SQLite |
| **A2A = Transport 层** | CrewAI | A2A 是 Subagent 的远程 transport，不引入新 loop 概念 |
| **Plugin 能力 = ExtensionAPI** | Pi-Mono | Plugin 可以"做事"，不只是"观察" |
| **事件类型 = 泛型约束** | Pi-Mono | 保持 Zod 验证，增加类型安全 |

### 2.3 分层架构

```
┌──────────────────────────────────────────────────────────┐
│                    用户应用层                             │
│  createAgent + Workflow + Plugin + SessionProvider        │
│  "用户组合框架原语构建自己的 Agent 应用"                     │
└──────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────────────────────────────────────┐
│              第一方可选原语 (agentforge/{domain})          │
│                                                          │
│  agentforge/workflow     → createWorkflow, createStep     │
│  agentforge/session      → SessionProvider, restore       │
│  agentforge/multi-agent  → SubagentRegistry, listAsTools  │
│  agentforge/a2a          → A2AClient, A2ATransport        │
│                                                          │
│  "像 Vue Router/Pinia — 需要时引入，不需要时不打包"         │
└──────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────────────────────────────────────┐
│                 核心框架 (agentforge)                      │
│                                                          │
│  createAgent() → AgentLoop → Tool Pipeline (5层)          │
│  Plugin System (10 hooks) → EventEmitter (Zod)            │
│  Compaction (6策略) → Error Recovery (4-tier)              │
│  LLM Adapters (5 providers) → MCP Client                  │
│                                                          │
│  "像 Vue Reactivity + Composition API — 框架最小核心"      │
└──────────────────────────────────────────────────────────┘
```

---

## 三、具体设计

### 3.1 Session 持久化与恢复

**问题**: `CheckpointStorage.load()` 接口存在，agent-loop 从未调用。会话无法恢复。

**设计**:

```typescript
// 新增: src/session/session-manager.ts

export interface SessionProvider {
  /** 保存会话快照 */
  save(sessionId: string, snapshot: SessionSnapshot): Promise<void>;
  /** 加载会话快照 */
  load(sessionId: string): Promise<SessionSnapshot | null>;
  /** 列出所有已保存会话 */
  list(): Promise<SessionSummary[]>;
  /** 删除会话 */
  delete(sessionId: string): Promise<void>;
}

export interface SessionSnapshot {
  sessionId: string;
  agentName: string;
  createdAt: number;
  updatedAt: number;
  state: AgentState;          // 完整 AgentState（含 messages）
  executedTools: ExecutedTool[];
  compactionHistory: CompactionHistory[];
  recoveryMetadata: RecoveryMetadata;
}

export interface SessionSummary {
  sessionId: string;
  agentName: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  stepCount: number;
}
```

```typescript
// agent-loop.ts 修改: 新增 resume 入口

export async function resumeAgentLoop(
  sessionId: string,
  provider: SessionProvider,
  config: AgentLoopConfig
): Promise<AgentLoop> {
  const snapshot = await provider.load(sessionId);
  if (!snapshot) throw new Error(`Session ${sessionId} not found`);

  return createAgentLoop({
    ...config,
    history: snapshot.state.messages,
    initialState: { ...snapshot.state, status: 'running' },
  });
}
```

```typescript
// agent-loop.ts 修改: 自动保存

// 在每次 LLM 响应 + 工具执行后（两处现有 checkpoint 保存点）：
if (config.sessionProvider) {
  await config.sessionProvider.save(state.sessionId, {
    sessionId: state.sessionId,
    agentName: config.model.model,
    createdAt: state.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    state,
    executedTools: checkpoint.executedTools ?? [],
    compactionHistory: checkpoint.compactionHistory ?? [],
    recoveryMetadata: checkpoint.recoveryMetadata ?? {},
  });
}
```

**变更清单**:
- 新建 `src/session/session-manager.ts` (~80行) — SessionProvider 接口 + SessionSnapshot/SessionSummary 类型
- 新建 `src/session/sqlite-session-provider.ts` (~100行) — 基于 better-sqlite3 的默认实现
- 修改 `src/loop/agent-loop.ts` — 新增 `resumeAgentLoop()` 入口 + 两处自动保存调用
- 修改 `src/index.ts` — 导出 `SessionProvider`, `SessionSnapshot`, `resumeAgentLoop`

---

### 3.2 Subagent → Tool 注册

**问题**: `SubagentRegistry` 完整但 agent-loop 从未调用。Subagent 是无法被 LLM 发现的"幽灵模块"。

**设计**:

```typescript
// 修改: src/subagent/registry.ts

export class SubagentRegistry implements ISubagentRegistry {
  // ... 现有方法保持不变 ...

  /** 将注册的所有 subagent 转换为 ToolDefinition 列表 */
  listAsTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const [name, entry] of this.#subagents) {
      tools.push({
        name: `delegate-to-${name}`,
        description: entry.config.description ?? `Delegate task to subagent: ${name}`,
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: `Task description for the ${name} subagent`,
            },
            maxSteps: {
              type: 'number',
              description: 'Maximum steps for the subagent (optional)',
            },
          },
          required: ['task'],
        },
        execute: async (toolCall) => {
          // 执行 subagent，父 Agent 的工具 pipeline 在此层仍然生效
          const result = await this.run(name, toolCall.task, () => {}, {
            parentSessionId: toolCall.parentSessionId,
          });
          return {
            content: result.output,
            metadata: {
              subagentName: name,
              subagentSteps: result.steps,
              subagentTokens: result.tokens,
              isError: result.isError,
            },
          };
        },
      });
    }
    return tools;
  }
}
```

```typescript
// agent-loop.ts 修改: 初始化时注册 subagent tools

// 在 createAgentLoop() 中, ctx 初始化后:
const subagentTools = config.subagentRegistry?.listAsTools() ?? [];
if (subagentTools.length > 0) {
  ctx.tools.registerAll(subagentTools);
}
```

**变更清单**:
- 修改 `src/subagent/registry.ts` — 新增 `listAsTools()` 方法 (~40行)
- 修改 `src/loop/agent-loop.ts` — 初始化时调用 `listAsTools()` + 注册工具 (~10行)
- 修改 `AgentLoopConfig` — 新增 `subagentRegistry?: SubagentRegistry` 字段

---

### 3.3 Workflow 编排 Agent

**问题**: `src/workflow/` 完整但独立。Workflow 和 Agent 是两个平行宇宙。

**设计**:

```typescript
// 新建: src/workflow/agent-step.ts

import type { Agent, AgentLoop, WorkflowStep } from './types.js';

export interface AgentStepOptions {
  /** 传给 Agent 的 prompt，支持模板变量 {input} */
  promptTemplate?: string;
  /** 从当前 step 输入的哪个字段提取 prompt */
  inputField?: string;
  /** Agent 的最大步数 */
  maxSteps?: number;
  /** 超时（ms） */
  timeout?: number;
  /** 失败时是否继续 */
  continueOnFailure?: boolean;
}

/**
 * 将一个 Agent 包装为 Workflow Step。
 * 参考 Mastra createStepFromAgent()
 */
export function createStepFromAgent(
  id: string,
  agent: Agent,
  options: AgentStepOptions = {}
): WorkflowStep {
  return {
    id,
    timeout: options.timeout,
    execute: async (input: unknown) => {
      // 从上游 step 输出中提取 prompt
      const prompt = resolvePrompt(input, options);

      // Agent.run() 内部经过完整的 5 层安全 pipeline
      const result = await agent.run(prompt);

      if (result.status === 'error' && !options.continueOnFailure) {
        throw new Error(`Agent step "${id}" failed: ${result.error?.message}`);
      }

      return {
        output: result.output,
        status: result.status,
        steps: agent.getState()?.step ?? 0,
      };
    },
  };
}

function resolvePrompt(input: unknown, options: AgentStepOptions): string {
  if (options.promptTemplate) {
    return options.promptTemplate.replace(/\{input\}/g, String(input));
  }
  if (options.inputField && typeof input === 'object' && input !== null) {
    return String((input as Record<string, unknown>)[options.inputField] ?? '');
  }
  return String(input ?? '');
}

/**
 * 将一个 AgentLoop 包装为 Workflow Step（L3 级别）。
 */
export function createStepFromAgentLoop(
  id: string,
  loop: AgentLoop,
  options: AgentStepOptions = {}
): WorkflowStep {
  return {
    id,
    timeout: options.timeout,
    execute: async (input: unknown) => {
      const prompt = resolvePrompt(input, options);
      const result = await loop.run(prompt);

      if (result.status === 'error' && !options.continueOnFailure) {
        throw new Error(`Agent step "${id}" failed: ${result.error?.message}`);
      }

      return { output: result.output, status: result.status };
    },
  };
}
```

**使用示例**:
```typescript
import { createAgent } from 'agentforge';
import { createWorkflow } from 'agentforge/workflow';
import { createStepFromAgent } from 'agentforge/workflow';

const researcher = createAgent({ name: 'researcher', ... });
const writer = createAgent({ name: 'writer', ... });
const reviewer = createAgent({ name: 'reviewer', ... });

const pipeline = createWorkflow({
  id: 'research-pipeline',
  steps: [
    createStepFromAgent('research', researcher),
    createStepFromAgent('write', writer, { promptTemplate: 'Write based on: {input}' }),
    createStepFromAgent('review', reviewer),
  ],
});

const result = await pipeline.run('Research AI safety');
```

**变更清单**:
- 新建 `src/workflow/agent-step.ts` (~90行)
- 修改 `src/workflow/index.ts` — 导出 `createStepFromAgent`, `createStepFromAgentLoop`, `AgentStepOptions`
- 无 agent-loop 变更（Workflow 是 Agent 的上层调用者，不修改 Agent 内部逻辑）

---

### 3.4 A2A 远程 Agent

**问题**: A2A 协议层完整但无真实 transport，agent-loop 无集成点。

**设计决策**: A2A 是 Subagent 的远程 transport。LLM 看到的 `delegate-to-remote-analyst` 工具和 `delegate-to-local-coder` 工具完全一样。区别只在 `execute()` 内部 — 一个调用 `SubagentRegistry.run()`（本地），一个通过 `A2AClient.request()`（远程）。

```typescript
// 修改: src/a2a/ 增加 transport 实现

// 新建: src/a2a/http-transport.ts
export class HTTPTransport implements A2ATransport {
  // 使用 fetch 实现 A2A 协议
  // POST {endpoint}/messages → A2AMessage
  // SSE 接收 server→client 推送
}

// 新建: src/a2a/ws-transport.ts
export class WebSocketTransport implements A2ATransport {
  // WebSocket 双向通信
}

// 修改: src/subagent/registry.ts 新增加远程注册方法
export class SubagentRegistry {
  // 现有本地注册
  register(config: SubagentConfig): void { ... }

  // 新增: 远程 Agent 注册
  registerRemote(config: RemoteSubagentConfig): void {
    const client = new A2AClient({
      agentId: config.name,
      transport: config.transport,
    });
    // 将远程 agent 包装为本地 SubagentConfig
    this.register({
      name: config.name,
      description: config.description,
      agent: createRemoteAgentLoop(client),
      mode: config.mode ?? 'async',
      isolated: true,
    });
    this.#a2aClients.set(config.name, client);
  }
}

export interface RemoteSubagentConfig {
  name: string;
  description: string;
  transport: A2ATransport;
  mode?: AgentMode;
}
```

**变更清单**:
- 新建 `src/a2a/http-transport.ts` (~120行)
- 新建 `src/a2a/ws-transport.ts` (~150行)
- 修改 `src/subagent/registry.ts` — 新增 `registerRemote()` (~30行)
- 修改 `src/a2a/index.ts` — 导出 `HTTPTransport`, `WebSocketTransport`
- **无需修改 agent-loop** — 远程 Agent 作为 Tool 暴露，和本地 Subagent 走同一路径

---

### 3.5 PluginContext 扩展

**问题**: PluginContext 只有 9 字段，插件只能"观察"，不能"参与"。

**设计**:

```typescript
// 修改: src/plugins/plugin.ts

export interface PluginContext {
  // === 已有 (9) ===
  readonly sessionId: string;
  readonly agentName: string;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  readonly logger?: Logger;
  readonly emitter: AgentEventEmitter;
  getState(): Readonly<AgentState>;
  listTools(): ToolDefinition[];
  addMessages(messages: Message[]): void;

  // === 新增 (5) ===
  /** 执行一个工具调用 — 让插件能自己调用工具 */
  executeTool(toolName: string, args: unknown): Promise<ToolResult>;

  /** 获取 LLM 适配器 — 让插件能发起独立的 LLM 调用 */
  getLLM(): LLMAdapter;

  /** 动态注册一个新工具 — 让插件能扩展 Agent 能力（参考 Pi-Mono registerTool） */
  registerTool(tool: ToolDefinition): void;

  /** 修改 Agent 状态 — 让插件能更新运行时状态 */
  setState(patch: Partial<AgentState>): void;

  /** 获取记忆存储 — 让插件能读取/写入长期记忆 */
  getMemory(): MemoryStore | undefined;
}
```

**对比 Pi-Mono ExtensionAPI**:
```
Pi-Mono ExtensionAPI (11组能力)         AgentForge PluginContext (14字段)
─────────────────────────────────────    ─────────────────────────────
pi.on("event", handler)              →  emitter (已有) + eventSubscriptions (已有)
pi.sendMessage(content, opts)        →  addMessages (已有)
pi.registerTool(tool)                →  registerTool (新增)
pi.registerCommand(name, opts)       →  不在 Plugin 层（CLI 产品的功能）
pi.registerShortcut(...)             →  不在 Plugin 层
pi.registerFlag(...)                 →  不在 Plugin 层
pi.setSessionName(name)              →  不在 Plugin 层（产品功能）
pi.setModel(model)                   →  setState({ model: ... }) (新增)
pi.getActiveTools()                  →  listTools() (已有)
pi.setActiveTools(names)             →  不在 Plugin 层（危险操作）
pi.registerProvider(...)             →  不在 Plugin 层
pi.exec(command, args, opts)         →  executeTool (新增)
```

**变更清单**:
- 修改 `src/plugins/plugin.ts` — PluginContext 新增 5 字段 (~15行)
- 修改 `src/plugins/manager.ts` — `buildPipeline()` 中构造 PluginContext 时传入新字段 (~20行)
- 修改 `src/plugins/pipeline.ts` — `applyPlugins()` 传递新 context 字段 (~10行)
- 修改 `src/api/create-agent.ts` — ensure 新字段有值 (~15行)

---

### 3.6 Hook 类型扩展

**问题**: 当前 6 种 Hook。构建 OpenCode 级产品需要至少 10 种。

**设计**:

```typescript
// 修改: src/core/hooks.ts

// === 新增 Hook 类型 ===

/** 修改 System Prompt — 在 LLM 调用前修改系统提示 */
export interface SystemPromptHook {
  name: string;
  priority: number;
  transform(systemPrompt: string, state: AgentState): string | Promise<string>;
}

/** 修改 LLM 调用参数 — 在 LLM 调用前修改 temperature/topP/maxTokens */
export interface LLMParamsHook {
  name: string;
  priority: number;
  transform(params: LLMParams, state: AgentState): LLMParams | Promise<LLMParams>;
}

export interface LLMParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  [key: string]: unknown;  // provider-specific params
}

/** 转换用户消息 — 在消息进入 LLM 前修改/过滤 */
export interface MessageHook {
  name: string;
  priority: number;
  transform(message: Message, state: AgentState): Message | Promise<Message>;
}

/** 工具执行 Hook — 在工具执行前后（参考 OpenCode tool.execute.before/after） */
export interface ToolExecuteHook {
  name: string;
  priority: number;
  /** 工具执行前 — 可修改参数 */
  beforeExecute?(toolCall: ToolCall, state: AgentState): ToolBeforeResult | Promise<ToolBeforeResult>;
  /** 工具执行后 — 可修改结果 */
  afterExecute?(toolCall: ToolCall, result: ToolResult, state: AgentState): ToolResult | Promise<ToolResult>;
}
```

```typescript
// 修改: src/plugins/plugin.ts Plugin 接口

export interface Plugin {
  readonly name: string;
  enabled: boolean;
  state?: Record<string, unknown>;

  // 已有 (6 种)
  requestHooks?: RequestHook[];
  toolHooks?: ToolHook[];
  eventSubscriptions?: EventSubscription[];
  checkpointHooks?: CheckpointHook[];
  recoveryHooks?: RecoveryHookEntry[];
  lifecycleHooks?: LifecycleHookEntry[];

  // 新增 (4 种)
  systemPromptHooks?: SystemPromptHook[];
  llmParamsHooks?: LLMParamsHook[];
  messageHooks?: MessageHook[];
  toolExecuteHooks?: ToolExecuteHook[];

  init?(ctx: PluginContext): void | Promise<void>;
  destroy?(): void;
}
```

```typescript
// agent-loop.ts 修改: 新增 hook 调用点

// 1. SystemPromptHook — 在 LLM 调用前、messages 组装时
let systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
for (const hook of hookRegistry.getSystemPromptHooks()) {
  systemPrompt = await hook.transform(systemPrompt, state);
}

// 2. LLMParamsHook — 在 LLM 调用前
let llmParams: LLMParams = { temperature: config.temperature, maxTokens: config.maxTokens };
for (const hook of hookRegistry.getLLMParamsHooks()) {
  llmParams = await hook.transform(llmParams, state);
}

// 3. MessageHook — 用户消息进入时
for (const hook of hookRegistry.getMessageHooks()) {
  userMessage = await hook.transform(userMessage, state);
}

// 4. ToolExecuteHook — 在 tool-executor.ts 中
// beforeExecute 在现有 ToolHook.beforeExecute 之后、Permission 检查之前调用
// afterExecute 在工具执行完成后、结果返回前调用
```

**变更清单**:
- 修改 `src/core/hooks.ts` — 新增 `SystemPromptHook`, `LLMParamsHook`, `MessageHook`, `ToolExecuteHook` 接口 + `LLMParams` 类型 (~60行)
- 修改 `src/core/hooks.ts` — `HookRegistry` 新增 4 项注册/查询方法 (~40行)
- 修改 `src/plugins/plugin.ts` — `Plugin` 接口新增 4 字段 (~12行)
- 修改 `src/loop/agent-loop.ts` — 新增 3 处 hook 调用点 (~25行)
- 修改 `src/loop/tool-executor.ts` — 新增 `ToolExecuteHook` 调用 (~20行)

---

### 3.7 LifecyclePhase 分层

**问题**: 10 种 LifecyclePhase 混在一个扁平 union，阻塞型/观察型/恢复型语义不同。

**设计**:

```typescript
// 修改: src/core/hooks.ts

/** 阻塞型 — 在关键切点阻塞循环，返回 CheckpointResult */
export type CheckpointPhase = 'pre-llm' | 'post-llm';

/** 观察型 — fire-and-forget，在生命周期节点触发 */
export type LifecyclePhase =
  | 'session.start'
  | 'session.end'
  | 'step.begin'
  | 'step.end'
  | 'tool.before'
  | 'tool.after'
  | 'compaction.before'
  | 'compaction.after';

/** 恢复型 — fire-and-forget，在错误/恢复节点触发 */
export type RecoveryPhase =
  | 'llm.error'
  | 'tool.error'
  | 'recovery.escalate'
  | 'recovery.compact'
  | 'recovery.fallback'
  | 'error';

// 保持向后兼容的联合类型（用于需要任意 phase 的场景）
export type AnyPhase = CheckpointPhase | LifecyclePhase | RecoveryPhase;
```

**对比当前**:
```
当前: 1 个扁平 LifecyclePhase 包含 10 个值（session.start, step.begin, llm.request.before, llm.response.after, tool.before, tool.after, compaction.before, compaction.after, session.end, step.end）
+ CheckpointPhase 独立（pre-llm, post-llm）
+ RecoveryPhase 独立（llm.error, tool.error, recovery.*, error）

修改后: 按语义分 3 组，各自独立类型，不在同一 union 中
- CheckpointPhase: pre-llm, post-llm（阻塞型，返回 CheckpointResult）
- LifecyclePhase: 8 个 fire-and-forget 观察节点
- RecoveryPhase: 6 个错误恢复节点
```

**变更清单**:
- 修改 `src/core/hooks.ts` — `LifecyclePhase` 值的调整 + 新增 `AnyPhase` (~10行变更)
- 需检查所有引用 `LifecyclePhase` 的地方，确认语义匹配

---

### 3.8 Streaming 路由到 EventEmitter

**问题**: `onChunk` 轻量回调绕过事件系统，插件无法订阅流式 chunks。

**设计**:

```typescript
// 修改: src/loop/llm-caller.ts

// 当前: onChunk 直接回调
// performStreamingLLMCall(ctx, config, onChunk)

// 修改后: onChunk 既回调用户，也 emit 事件
async function performStreamingLLMCall(
  ctx: AgentContext,
  config: AgentLoopConfig,
  onChunk?: (chunk: LLMChunkEvent) => void
): Promise<LLMCallResult> {
  // ... streaming 逻辑 ...

  const wrappedOnChunk = (chunk: LLMChunkEvent) => {
    // 1. 用户回调仍然保留
    onChunk?.(chunk);

    // 2. 新: 发射到事件系统，插件可订阅
    ctx.emitter.emit({
      type: 'llm.chunk',
      content: chunk.content,
      toolCallDelta: chunk.toolCallDelta,
      finishReason: chunk.finishReason,
      usage: chunk.usage,
      sequence: chunk.sequence,
      agentName: ctx.identity.agentName,
      sessionId: ctx.identity.sessionId,
    });
  };

  return performStreamingLLMCallInternal(ctx, config, wrappedOnChunk);
}
```

```typescript
// 修改: src/core/events.ts

// 新增 llm.chunk 事件（轻量版，不做全量 Zod 验证，仅验证 type 字段）
export const LLMChunkEventSchema = z.object({
  type: z.literal('llm.chunk'),
  agentName: z.string(),
  sessionId: z.string(),
  content: z.string().optional(),
  toolCallDelta: ToolCallDeltaSchema.optional(),
  finishReason: z.string().optional(),
  usage: LLMUsageSchema.optional(),
  sequence: z.number(),
});
```

**变更清单**:
- 修改 `src/loop/llm-caller.ts` — `wrappedOnChunk` 增加 emit (~10行)
- 修改 `src/core/events.ts` — 新增 `LLMChunkEventSchema` (~10行)
- 不需要修改 agent-loop（chunk emit 在 llm-caller 内部完成）

---

### 3.9 Sub-path Exports 清理

**问题**: 26 个子路径暴露全部内部实现。

**设计**:

```jsonc
// package.json exports 字段
{
  "exports": {
    // 主入口: 核心 API（~70 symbols）
    ".": "./src/index.ts",

    // 可选原语（语义清晰的 6 个包）
    "./workflow": "./src/workflow/index.ts",
    "./session": "./src/session/index.ts",
    "./multi-agent": "./src/subagent/index.ts",
    "./a2a": "./src/a2a/index.ts",
    "./adapters": "./src/adapters/index.ts",
    "./mcp": "./src/mcp/index.ts",

    // 兼容别名
    "./core": "./src/index.ts",
    "./loop": "./src/index.ts",
    "./plugins": "./src/index.ts",
    "./memory": "./src/index.ts"
  }
}
```

**变更清单**:
- 修改 `package.json` — `exports` 字段 26→10 条
- 新建 `src/session/index.ts` — 重导出 session 相关 public API
- 需验证所有现有 import 路径兼容

---

## 四、实施顺序

```
Phase 1: 连线（最低风险，最高收益）
─────────────────────────────────
1.1 Subagent → Tool 注册     (~50行)   → LLM 立即能调用子 Agent
1.2 Workflow → Agent 桥接    (~90行)   → 工作流可编排 Agent
1.3 Session 恢复入口         (~80行)   → 会话可暂停/恢复

Phase 2: 扩展（中等风险，构建 OpenCode 必需）
─────────────────────────────────
2.1 PluginContext 扩展       (~60行)   → 插件从"观察"升级到"参与"
2.2 Hook 类型增加            (~160行)  → systemPrompt/llmParams/message/toolExecute
2.3 Streaming 路由到 Emitter (~20行)   → 插件可订阅流式 chunks

Phase 3: 补齐与清理
─────────────────────────────────
3.1 A2A Transport 实现       (~270行)  → HTTP + WebSocket transport
3.2 Remote Subagent 注册     (~30行)   → A2A Agent 无缝注册
3.3 LifecyclePhase 分层      (~10行)   → 类型语义清晰
3.4 Sub-path Exports 清理    (package.json) → API 面干净
```

## 五、工作量估算

| Phase | 新增文件 | 修改文件 | 新增代码 | 变更代码 | 风险 |
|-------|---------|---------|---------|---------|------|
| Phase 1 | 2 (`session-manager.ts`, `agent-step.ts`) | 4 | ~220行 | ~50行 | 低 |
| Phase 2 | 0 | 6 | ~210行 | ~30行 | 中 |
| Phase 3 | 2 (`http-transport.ts`, `ws-transport.ts`) | 5 | ~300行 | ~20行 | 低 |
| **合计** | **4** | **15** | **~730行** | **~100行** | — |

所有变更都是增量添加，不破坏现有 API。现有 2487 测试不受影响。
