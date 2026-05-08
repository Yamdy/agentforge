# AgentForge Architecture V2

> 2026-05-07 | 基于 `.tmp/` 下 7 个项目对比分析 + 源码评估

## 一、定位

AgentForge 是一个 Agent 开发框架。区别于其他框架的核心差异：

| 维度 | AgentForge |
|------|-----------|
| 可观测性 | **第一公民**——内嵌内核，不是外挂模块 |
| 扩展模型 | 统一 Hook 接口——一个接口覆盖全链路 |
| 控制原语 | abort/pause/retry/recovery 一等公民 |
| 透明度 | `diagnose()` 内置配置溯源 + 运行时诊断 |
| 易用性 | L1(配置) → L2(Builder) → L3(程序化) 递进 |
| 类型安全 | Zod + TypeScript strict，全链路类型覆盖 |

## 二、当前架构评估

经过对 15 个核心模块的逐项审查：

```
KEEP (无需改动):  events, state, state-machine, a2a, working-memory, security, interfaces
REFACTOR (局部调整): context (加 TraceContext), tool-executor (Hook 调用适配), workflow (Trace 传播)
REWRITE (架构调整): hooks (统一接口), index (更新公共 API)
```

**现有架构骨架是正确的。** HookRegistry + EventEmitter + AbortController 的组合不需要替换为 Middleware Pipeline 或 EventBus。需要的是三层优化：

1. Hook 接口统一（10 → 1）
2. TraceContext 升级为第一公民
3. 新增 `diagnose()` API

## 三、变更设计

### 变更 1：统一 Hook 接口

**问题：** 当前有 10 种 Hook 接口，用户（和框架内部）需要知道每种的使用场景。

```
现状:                     目标:
RequestHook            ─┐
ToolHook                │
CheckpointHook          │
LifecycleHookEntry      │
RecoveryHookEntry       ├──→  AgentHook (单一接口)
SystemPromptHook        │    每个钩子方法可选
LLMParamsHook           │    只实现你关心的
MessageHook             │
ToolExecuteHook         │
ToolBeforeResult       ─┘
```

新接口：

```typescript
interface AgentHook {
  /** 唯一标识，用于 diagnose() 和调试 */
  name: string;
  /** 执行顺序，越小越先执行，默认 100 */
  priority?: number;

  // ── LLM 调用链路 ──
  /** 调用前：修改 messages、注入记忆/技能/工作记忆，可返回 'abort' 阻止调用 */
  beforeLLM?: (ctx: BeforeLLMCtx) => MaybeAsync<Message[] | 'abort'>;
  /** 调用后：检查结果、更新记忆、触发质量门禁 */
  afterLLM?: (ctx: AfterLLMCtx) => MaybeAsync<void>;
  /** 流式 chunk：只读观察，同步 fire-and-forget，不应修改 chunk */
  onLLMChunk?: (chunk: LLMChunk) => void;

  // ── 工具执行链路 ──
  /** 工具定义过滤：每次 LLM 调用前，过滤/注入可用工具 */
  filterTools?: (tools: ToolDef[], state: AgentState) => MaybeAsync<ToolDef[]>;
  /** 工具执行前：参数校验、权限检查、速率限制，可返回 'block' 阻止执行 */
  beforeTool?: (ctx: BeforeToolCtx) => MaybeAsync<ToolCall | 'block'>;
  /** 工具执行后：结果校验、修改输出、审计日志 */
  afterTool?: (ctx: AfterToolCtx) => MaybeAsync<void>;

  // ── 控制链路 ──
  /** 系统提示词转换 */
  transformSystemPrompt?: (prompt: string, state: AgentState) => MaybeAsync<string>;
  /** LLM 参数转换（temperature、maxTokens 等） */
  transformLLMParams?: (params: LLMParams, state: AgentState) => MaybeAsync<LLMParams>;
  /** 用户消息转换 */
  transformMessage?: (msg: Message, state: AgentState) => MaybeAsync<Message>;

  // ── 生命周期观察 ──
  /** 状态变更 */
  onStateChange?: (from: string, to: string) => void;
  /** Checkpoint 保存/恢复 */
  onCheckpoint?: (cp: Checkpoint) => MaybeAsync<void>;
  /** Compaction 前后 */
  onCompact?: (ctx: CompactCtx) => MaybeAsync<void>;
  /** Error + Recovery 事件 */
  onError?: (ctx: ErrorCtx) => MaybeAsync<RecoveryAction | void>;
}
```

**与旧接口的映射：**

| 旧 Hook | 新 AgentHook 方法 |
|---------|------------------|
| `RequestHook.apply()` | `beforeLLM()` |
| `ToolHook.filter()` | `filterTools()` |
| `ToolHook.beforeExecute()` | `beforeTool()` |
| `ToolExecuteHook` | `afterTool()` |
| `CheckpointHook` | 拆分为 `beforeLLM` + `afterLLM`（返回 'abort'/'block'） |
| `LifecycleHookEntry` | `onStateChange` / `onCheckpoint` / `onCompact` / `onError` |
| `RecoveryHookEntry` | `onError()` 返回 `RecoveryAction` |
| `SystemPromptHook` | `transformSystemPrompt()` |
| `LLMParamsHook` | `transformLLMParams()` |
| `MessageHook` | `transformMessage()` |

### 变更 2：TraceContext 升级为第一公民

**问题：** TraceContext 当前在 `src/observability/trace-context.ts`，是一个独立的查询接口。Loop 中不自动产生 Span。

**方案：** 将 TraceContext 移到 `src/core/trace.ts`，成为 AgentContext 的一等字段：

```typescript
// src/core/trace.ts
interface TraceContext {
  /** 开启一个 Span，自动关联当前 runId */
  startSpan(name: string, attrs?: Record<string, unknown>): Span;
  /** 获取当前活跃 Span */
  currentSpan(): Span | undefined;
  /** 导出到配置的 exporter */
  export(): Promise<void>;
}

interface Span {
  readonly id: string;
  readonly parentId?: string;
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
  recordException(error: Error): void;
  end(): void;
}
```

```typescript
// src/core/context.ts — AgentContext 中新增
interface AgentContext {
  // ... 现有字段
  trace: TraceContext;  // ← 移至 core，成为第一公民
}
```

Loop 中的自动埋点：

```typescript
// agent-loop.ts 中每个关键路径自动 Span
const turnSpan = ctx.trace.startSpan('agent.turn', { turnIndex });
const llmSpan = ctx.trace.startSpan('agent.llm.call', { model: config.model });
// ... LLM 调用 ...
llmSpan.setAttribute('tokens.input', usage.input);
llmSpan.setAttribute('tokens.output', usage.output);
llmSpan.setAttribute('cost.total', cost.total);
llmSpan.end();

const toolSpan = ctx.trace.startSpan('agent.tool.execute', { toolName: tc.name });
// ... Tool 执行 ...
toolSpan.end();
turnSpan.end();
```

**对现有代码的影响：**
- `src/observability/trace-context.ts` → 移动到 `src/core/trace.ts`，接口扩展
- `src/observability/` 保留 OTel exporter、metrics、health checker 等纯导出逻辑
- `AgentContext` 的初始化代码加一行 `trace: createTraceContext(config)`

### 变更 3：diagnose() — 配置溯源 + 运行时透明

**新增 API：**

```typescript
interface AgentDiagnosis {
  /** Agent 身份 */
  identity: {
    sessionId: string;
    agentName: string;
    runId: string;
  };

  /** 模型配置溯源 */
  model: {
    current: { provider: string; model: string };
    source: 'config-file' | 'builder-api' | 'programmatic' | 'env-override';
    overrides: Array<{ from: string; to: string; source: string }>;
  };

  /** Hook 链状态 */
  hooks: Array<{
    name: string;
    priority: number;
    methods: string[];         // 实现了哪些钩子方法
    status: 'active' | 'error';
    errorCount: number;
    avgLatencyMs?: number;
    source: string;            // 来自哪个 Plugin 或直接注册
  }>;

  /** 工具状态 */
  tools: Array<{
    name: string;
    callCount: number;
    errorRate: number;
    avgDurationMs: number;
    source: string;
  }>;

  /** 运行时统计 */
  runtime: {
    turnCount: number;
    totalTokens: { input: number; output: number };
    totalCost: { input: number; output: number; total: number };
    checkpointCount: number;
    lastCheckpointAt?: number;
    errorCount: number;
    retryCount: number;
    status: string;
  };

  /** Trace 信息 */
  trace: {
    rootSpanId: string;
    currentSpanId?: string;
    exporter: string;
    exportedAt?: number;
    spanCount: number;
  };
}

// 使用：
const diag = agent.diagnose();
// 输出完整 JSON，可用于调试、日志、Dashboard
```

**实现方式：** `AgentLoop` 内部维护一个 `DiagnosisCollector`，Hook 执行时自动记录耗时和错误计数。`diagnose()` 方法在 `AgentLoop` 接口上新增：

```typescript
interface AgentLoop {
  // ... 现有方法
  diagnose(): AgentDiagnosis;
}
```

## 四、对公共 API 的影响

### 对外导出变更

```typescript
// 旧（废弃，保留兼容）：
export type { RequestHook, ToolHook, CheckpointHook, LifecycleHookEntry, ... } from './core/hooks.js';

// 新：
export type { AgentHook } from './core/hooks.js';
export type { AgentDiagnosis } from './core/diagnosis.js';
export type { TraceContext, Span } from './core/trace.js';

// 兼容期：旧类型作为 AgentHook 的别名保留一个版本
```

### Plugin 接口变更

```typescript
// 旧：
interface Plugin {
  name: string;
  requestHooks?: RequestHook[];
  toolHooks?: ToolHook[];
  checkpointHooks?: CheckpointHook[];
  lifecycleHooks?: LifecycleHookEntry[];
  recoveryHooks?: RecoveryHookEntry[];
  systemPromptHooks?: SystemPromptHook[];
  llmParamsHooks?: LLMParamsHook[];
  messageHooks?: MessageHook[];
  toolExecuteHooks?: ToolExecuteHook[];
  eventSubscriptions?: EventSubscription[];
}

// 新：
interface Plugin {
  name: string;
  hooks?: AgentHook[];  // ← 一个数组，每个 Hook 可以含任意组合的钩子方法
  eventSubscriptions?: EventSubscription[];  // 不变
}
```

### HookRegistry 变更

```typescript
// 旧：10 个独立注册方法 + 10 个独立 Getter
class HookRegistry {
  registerRequest(hook: RequestHook): () => void;
  registerTool(hook: ToolHook): () => void;
  registerCheckpoint(hook: CheckpointHook): () => void;
  registerLifecycle(hook: LifecycleHookEntry): () => void;
  // ... 6 more

  getRequestHooks(): RequestHook[];
  getToolHooks(): ToolHook[];
  // ... 8 more
}

// 新：统一注册 + 按方法名查询
class HookRegistry {
  register(hook: AgentHook): () => void;

  /** 获取实现了指定方法的 Hook（按 priority 排序） */
  getFor<K extends keyof AgentHook>(method: K): AgentHook[];

  /** 执行指定 phase 的所有 Hook */
  async runPhase<K extends keyof AgentHook>(
    method: K,
    ctx: Parameters<NonNullable<AgentHook[K]>>[0]
  ): Promise<{ aborted: boolean; result?: unknown }>;
}
```

## 五、实施计划

### Phase 1：统一 Hook 接口（不破坏现有 API）

1. 在 `src/core/hooks.ts` 中新增 `AgentHook` 接口
2. 在 `HookRegistry` 中新增 `register()` 方法（旧的 10 个注册方法标记 deprecated 但保留）
3. 在 `Plugin` 中新增 `hooks?: AgentHook[]` 字段（旧字段保留兼容）
4. 所有内置 Plugin 迁移到新接口
5. `agent-loop.ts` 中的 cut-point 调用改为 `hooks.runPhase('beforeLLM', ctx)` 形式

### Phase 2：TraceContext 升级

1. 创建 `src/core/trace.ts`，定义 `TraceContext` + `Span` 接口
2. 在 `AgentContext` 中加入 `trace: TraceContext` 字段
3. `agent-loop.ts` 每个关键路径加入自动 Span
4. `src/observability/` 中的 OTel 实现适配新接口

### Phase 3：diagnose() + 公共 API 更新

1. 新增 `src/core/diagnosis.ts`，定义 `AgentDiagnosis` 类型和 `DiagnosisCollector`
2. `AgentLoop` 接口新增 `diagnose()` 方法
3. `src/index.ts` 更新公共 API 导出
4. 添加测试：Hook 统一测试、Trace Span 测试、diagnose() 输出测试

### Phase 4：清理

1. 移除 deprecated 的旧 Hook 接口
2. 移除 Plugin 上旧的分散字段
3. 更新所有子路径导出

## 六、不变的内容

以下模块无需任何改动：

- `src/core/events.ts` — Zod 事件系统
- `src/core/state.ts` — AgentState
- `src/core/state-machine.ts` — 状态机
- `src/core/interfaces.ts` — DI 接口
- `src/adapters/` — LLM 适配器
- `src/security/` — 安全层（blocklist, permission, sanitization, sandbox, audit, rate-limit）
- `src/memory/` — 记忆系统（compaction, working memory, vector stores）
- `src/a2a/` — A2A 协议
- `src/subagent/` — 子Agent
- `src/workflow/` — 工作流（仅需传播 TraceContext）
- `src/mcp/` — MCP 集成
- `src/evaluation/` — 评估框架
- `src/tools/` — 内置工具
- `src/loop/tool-executor.ts` — 工具执行管道（仅需适配新 Hook 调用方式）

## 七、与 .tmp/ 项目的定位对比（最终版）

| | AgentForge V2 | DeepAgents | Mastra | AgentScope | CrewAI |
|---|---|---|---|---|---|
| 统一 Hook | ✅ AgentHook | ✅ Middleware | ⚠️ Processors | ✅ 元类Hook | ⚠️ 装饰器 |
| 可观测性 | ✅ 内核 Span | ⚠️ 外部 | ✅ 11导出器 | ⚠️ Studio | ⚠️ 基础 |
| 控制原语 | ✅ abort/pause/retry | ⚠️ interrupt | ✅ suspend | ⚠️ interrupt | ⚠️ |
| diagnose() | ✅ 内置 | ❌ | ❌ | ❌ | ❌ |
| 类型安全 | ✅ Zod strict | ⚠️ Python | ✅ TS | ❌ Python | ❌ Python |
| L1/L2/L3 | ✅ 三层 | ⚠️ 单入口 | ✅ CLI+API | ⚠️ | ✅ YAML+@deco |
| 代码量 | ~48K 行 | ~54K 行(core) | ~112K 行 | ~44K 行 | ~146K 行 |
