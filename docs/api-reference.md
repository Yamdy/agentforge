# API Reference

AgentForge 公共 API 参考。按包分组，覆盖类型、类和函数导出。

> **包版本**: @primo-ai/core 0.1.5

---

## 目录

- [@primo-ai/sdk — 类型定义](#agentsdorge-sdk--类型定义)
  - [PipelineContext 四区域](#pipelinecontext-四区域)
  - [Processor 系统](#processor-系统)
  - [Tool 系统](#tool-系统)
  - [Plugin 系统](#plugin-系统)
  - [消息与指令](#消息与指令)
  - [可观测性类型](#可观测性类型)
  - [模型与网关](#模型与网关)
  - [Provider 兼容性](#provider-兼容性)
  - [Session 持久化](#session-持久化)
  - [Sub-Agent](#sub-agent)
  - [运行时安全](#运行时安全)
  - [其他类型](#其他类型)
- [@primo-ai/core — 运行时](#agentforge-core--运行时)
  - [Agent](#agent)
  - [PipelineRunner](#pipelinerunner)
  - [LLMInvoker](#llminvoker)
  - [ToolRegistry](#toolregistry)
  - [Session 类](#session-类)
  - [ConfigLoader](#configloader)
  - [Processors](#processors)
  - [Gateways](#gateways)
  - [Provider Capabilities](#provider-capabilities)
  - [工具函数](#工具函数)
  - [并发与容错](#并发与容错)
  - [Sub-Agent](#sub-agent-1)
  - [ModelFactory](#modelfactory)
  - [StateMachine](#statemachine)
  - [LoopOrchestrator](#looporchestrator)
  - [ContextBuilder](#contextbuilder)
  - [EventSystem](#eventsystem)
  - [HookManager](#hookmanager)
  - [CheckpointStore](#checkpointstore)
  - [序列化](#序列化)
  - [错误体系](#错误体系)
  - [SyncEvent 事件溯源](#syncevent-事件溯源)
  - [TiktokenCounter](#tiktokencounter)
- [@primo-ai/server — HTTP 服务器](#agentforge-server--http-服务器)
  - [HTTP API 端点](#http-api-端点)
  - [A2A Protocol](#a2a-protocol)
- [@primo-ai/tools — 内置工具](#agentforge-tools--内置工具)
- [@primo-ai/observability — 可观测性](#agentforge-observability--可观测性)
- [@primo-ai/plugins — 官方插件](#agentforge-plugins--官方插件)
  - [memoryPlugin](#memoryplugin)
  - [compressionPlugin](#compressionplugin)
  - [evictionPlugin](#evictionplugin)
  - [permissionPlugin](#permissionplugin)
  - [skillPlugin](#skillplugin)
  - [mcpPlugin](#mcpplugin)
  - [Harness Processors](#harness-processors)

---

## @primo-ai/sdk — 类型定义

零运行时依赖的纯类型包。所有导出均为 TypeScript 类型/接口。

```ts
import type { AgentConfig, Processor, Tool, PipelineContext } from '@primo-ai/sdk';
```

### PipelineContext 四区域

每个 pipeline 阶段接收一个 `PipelineContext`，包含四个区域：

#### `RequestRegion` — 不可变输入

```ts
interface RequestRegion {
  input: string;       // 用户消息
  sessionId: string;   // 会话 ID
}
```

#### `AgentRegion` — Agent 配置

```ts
interface AgentRegion {
  config: AgentConfig;
  systemPrompt?: string;
  toolDeclarations: Array<{ name: string; description: string }>;
  promptFragments: string[];
  providerOptions?: Record<string, Record<string, unknown>>;
}
```

#### `IterationRegion` — 单步状态

```ts
interface IterationRegion {
  step: number;
  loopDirective?: LoopDirective;
  fullStream?: AsyncIterable<unknown>;
  usagePromise?: Promise<TokenUsage>;
  reasoningPromise?: Promise<string | undefined>;
  response?: string;
  tokenUsage?: TokenUsage;
  pendingToolCalls?: ToolCall[];
  reasoningContent?: string;
  toolResults?: ToolResult[];
  span?: Span;
}
```

#### `SessionRegion` — 跨步状态

```ts
interface SessionRegion {
  messageHistory?: Message[];
  totalTokenUsage?: TokenUsage;
  custom: Record<string, unknown>;  // 插件扩展点
}
```

#### `PipelineContext`

```ts
interface PipelineContext {
  request: RequestRegion;
  agent: AgentRegion;
  iteration: IterationRegion;
  session: SessionRegion;
}
```

### Processor 系统

#### `PipelineStage`

11 个生命周期阶段：

```ts
type PipelineStage =
  | 'processInput' | 'buildContext' | 'prepareStep'
  | 'gateLLM' | 'invokeLLM' | 'processStepOutput'
  | 'gateTool' | 'executeTools' | 'evaluateIteration' | 'processOutput'
  | 'beforeTool' | 'execute' | 'afterTool';
```

Pipeline 流程：

```
processInput → buildContext → [Agentic Loop:
  prepareStep → gateLLM → invokeLLM → processStepOutput → gateTool → executeTools → evaluateIteration
] → processOutput
```

#### `Processor` (v2 API)

```ts
interface Processor {
  stage: PipelineStage;
  /** @deprecated Use executeV2 instead */
  execute(context: PipelineContext): Promise<ProcessorResult>;
  /** v2 API: receives ProcessorContext with state + control flow API */
  executeV2?(context: ProcessorContext): Promise<PipelineContext | void>;
  isNoOp?: boolean;
}
```

#### `ProcessorContext`

v2 API 上下文，提供状态访问和流程控制：

```ts
interface ProcessorContext {
  state: PipelineContext;        // 可变状态
  control: ProcessorControl;     // 流程控制 API
}

interface ProcessorControl {
  abort(reason: string, retryFrom?: StageName): never;   // 中止 pipeline
  suspend(suspensionId: string, checkpoint?: Partial<PipelineCheckpoint>): never;  // 挂起 pipeline
}
```

**v2 API 用法示例：**

```ts
const myProcessor: Processor = {
  stage: 'gateTool',
  async executeV2(ctx) {
    const toolCalls = ctx.state.iteration.pendingToolCalls ?? [];
    if (toolCalls.some(tc => dangerousTools.includes(tc.name))) {
      ctx.control.abort('Dangerous tool not allowed');
    }
  },
};
```

#### `ProcessorResult` (v1 API, deprecated)

```ts
/** @deprecated Use ProcessorContext with ctx.control.abort()/suspend() instead */
type ProcessorResult = PipelineContext | AbortSignal | SuspensionSignal | ErrorResult;
```

#### `AbortSignal` / `SuspensionSignal`

数据结构，用于 StreamEvent 和内部传递：

```ts
interface AbortSignal {
  type: 'abort';
  reason: string;
  retryFrom?: StageName;
}

interface SuspensionSignal {
  type: 'suspend';
  suspensionId: string;
  reason: string;
  checkpoint: PipelineCheckpoint;
}
```
```

### Tool 系统

#### `Tool<TInput, TOutput>`

```ts
interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;           // Zod schema
  outputSchema?: unknown;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  requireApproval?: boolean;
  renderCall?(input: TInput): string;
  renderResult?(output: TOutput): string;
}
```

#### `ToolExecutionContext`

```ts
interface ToolExecutionContext {
  harness?: unknown;
  span?: unknown;
  sessionId?: string;
  pluginManager?: WrapHookInvoker;
}
```

### Plugin 系统

#### `HarnessAPI`

插件通过 HarnessAPI 与框架交互：

```ts
interface HarnessAPI {
  registerProcessor(processor: Processor): void;
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): void;
  registerCommand(name: string, handler: (args: string) => Promise<void>): void;
  registerHook(hook: Hook): void;
  subscribe(eventType: string, handler: (...args: unknown[]) => void): void;
  registerResource(resource: ResourceDeclaration): void;
  registerProvider(name: string, factory: ProviderFactory): void;
}
```

#### `PluginRegistration`

```ts
interface PluginRegistration {
  processors?: Processor[];
  tools?: ToolDefinition[];
  commands?: Record<string, (args: string) => Promise<void>>;
}
```

插件是一个工厂函数：

```ts
type PluginFactory = (harness: HarnessAPI) => PluginRegistration | Promise<PluginRegistration>;
```

#### `HookPoint`

12 个拦截点：

| HookPoint | 时机 | 用途 |
|-----------|------|------|
| `agent.start` | Pipeline 开始前 | 初始化、遥测 |
| `agent.end` | Pipeline 完成后 | 清理、指标 |
| `stage.before` | 任意阶段执行前 | 上下文注入 |
| `stage.after` | 任意阶段完成后 | 后处理 |
| `llm.before` | LLM 调用前 | Prompt 修改 |
| `llm.after` | LLM 响应后 | 响应转换 |
| `llm.wrap` | 包裹整个 LLM 调用 | 错误恢复、缓存 |
| `tool.before` | 工具执行前 | 权限检查 |
| `tool.after` | 工具执行后 | 日志、驱逐 |
| `tool.wrap` | 包裹整个工具执行 | 结果驱逐、计时 |
| `iteration.end` | 每次循环迭代后 | 进度追踪 |
| `error` | 任何错误时 | 错误上报 |

### 消息与指令

#### `Message`

```ts
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoningContent?: string }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string; result?: unknown; error?: string };
```

#### `LoopDirective`

```ts
type LoopDirective =
  | { action: 'continue' }
  | { action: 'stop' }
  | { action: 'retry'; retryFrom: PipelineStage };
```

### 可观测性类型

#### `Span`

```ts
interface Span {
  readonly name: string;
  startChild(name: string): Span;
  end(): void;
  setAttribute(key: string, value: unknown): Span;
  addEvent(name: string, attributes?: Record<string, unknown>): Span;
  spanContext(): SpanContext;
}
```

#### `Tracer`

```ts
interface Tracer {
  startSpan(name: string): Span;
  getCurrentSpan(): Span | undefined;
}
```

#### `TokenUsage`

```ts
interface TokenUsage {
  input: number;
  output: number;
}
```

### 模型与网关

#### `AgentConfig`

```ts
interface AgentConfig {
  model: string;                                // "provider/modelId" 格式
  systemPrompt?: Dynamic<string>;
  maxIterations?: Dynamic<number>;
  tools?: Tool[];
  providerOptions?: Record<string, Record<string, unknown>>;
}
```

#### `Dynamic<T>`

静态值或根据请求上下文动态解析的函数：

```ts
type Dynamic<T> = T | ((ctx: ResolveContext) => T | Promise<T>);

interface ResolveContext {
  input: string;
  sessionId: string;
  metadata: Record<string, unknown>;
}
```

#### `ModelProfile`

按模型模式匹配的行为定制：

```ts
interface ModelProfile {
  modelPattern: string | RegExp;
  systemPromptSuffix?: string;
  toolOverrides?: { [toolName: string]: { description?: string; exclude?: boolean } };
  extraPromptFragments?: PromptFragment[];
}
```

#### `GatewayConfig`

```ts
interface GatewayConfig {
  name: string;
  url: string;
  apiKey?: string;
}
```

#### `ModelGateway`

```ts
interface ModelGateway {
  name: string;
  canResolve(modelString: string): boolean;
  resolve(modelString: string): Promise<unknown>;
}
```

### Provider 兼容性

#### `ProviderCapabilities`

```ts
interface ProviderCapabilities {
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  supportsParallelToolCalls: boolean;
  requiresAlternatingRoles: boolean;
  rejectsEmptyAssistantContent: boolean;
  toolCallIdPattern?: RegExp;
}
```

#### `CompatRule`

```ts
interface CompatRule {
  name: string;
  providers: string[];
  applyToPrompt?(messages: Message[], capabilities: ProviderCapabilities): Message[];
  fixHistory?(history: Message[], error: unknown): Message[];
  errorPatterns?: RegExp[];
}
```

### Session 持久化

#### `SessionRecord`

```ts
interface SessionRecord {
  sessionId: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;  // 'active' | 'completed' | 'suspended' | 'error'
  model?: string;
  tokenUsage?: TokenUsage;
}
```

#### `SessionStorage`

```ts
interface SessionStorage {
  append(sessionId: string, event: SessionEvent): Promise<void>;
  read(sessionId: string): AsyncIterable<SessionEvent>;
  list(filter?: { parentSessionId?: string; status?: SessionStatus }): Promise<SessionRecord[]>;
  updateMeta(sessionId: string, meta: Partial<SessionRecord>): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | undefined>;
  delete(sessionId: string): Promise<void>;
  getMessages(sessionId: string, options?: { limit?: number; before?: string }): Promise<Message[]>;
}
```

- `get()` — 单会话查找，避免扫描全部会话
- `delete()` — 删除会话及所有事件
- `getMessages()` — 从事件流重建 `Message[]`，支持分页

#### `SessionManager`

```ts
interface SessionManager {
  start(input: string, options?: unknown): Promise<SessionRecord>;
  restore(sessionId: string): Promise<SessionRecord>;
  suspend(sessionId: string, reason: string): Promise<void>;
  resume(sessionId: string, input?: string): Promise<SessionRecord>;
  list(filter?: unknown): Promise<SessionRecord[]>;
}
```

### Sub-Agent

#### `SubAgentConfig`

```ts
interface SubAgentConfig {
  name: string;
  description?: string;
  inputSchema?: unknown;
  model?: string;
  systemPrompt?: string;
  tools?: Tool[];
  maxIterations?: number;
  contextPolicy: 'isolated' | 'inherit' | 'summary-only';
  summarizeFn?: SummarizeFn;  // contextPolicy 为 'summary-only' 时使用
}
```

### 运行时安全

#### `ConcurrencySlot`

```ts
interface ConcurrencySlot {
  key: string;
  maxConcurrent: number;
}
```

#### `FallbackEntry`

```ts
interface FallbackEntry {
  model: string;
  priority: number;
}
```

#### `AsyncTaskHandle`

```ts
interface AsyncTaskHandle {
  taskId: string;
  status: AsyncTaskStatus;
  result?: SubAgentResult;
  error?: Error;
  cancel(): void;
  on_complete(handler: (result: SubAgentResult) => void): void;
}
```

### 其他类型

#### `StreamEvent`

```ts
type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'stage_start'; stage: PipelineStage }
  | { type: 'stage_complete'; stage: PipelineStage }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolResult: ToolResult }
  | { type: 'complete'; response: string }
  | { type: 'abort'; signal: AbortSignal };
```

#### `ServerStreamEvent`

```ts
type ServerStreamEvent = StreamEvent
  | { type: 'session.started'; sessionId: string }
  | { type: 'session.completed'; sessionId: string; tokenUsage: TokenUsage }
  | { type: 'session.aborted'; sessionId: string }
  | { type: 'permission.request'; sessionId: string; permissionId: string; toolName: string; args: Record<string, unknown>; reason: string }
  | { type: 'permission.resolved'; sessionId: string; permissionId: string; decision: 'allow' | 'deny' };
```

扩展 `StreamEvent`，增加 Session 生命周期和 Permission 交互事件，用于 SSE 事件流。

#### `SpanType`

```ts
const SpanType = {
  AGENT_RUN: 'agent_run',
  MODEL_STEP: 'model_step',
  TOOL_CALL: 'tool_call',
  PROCESSOR_RUN: 'processor_run',
} as const;
```

#### `McpServerConfig`

```ts
interface McpServerConfig {
  name: string;
  transport?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}
```

---

## @primo-ai/core — 运行时

```ts
import {
  Agent, PipelineRunner, resolveModel, registerProvider,
  ModelFactory, StateMachine, LoopOrchestrator,
  ContextBuilder, EventSystem, HookManager, EventBus,
  serialize, deserialize,
  InMemoryCheckpointStore, JsonlCheckpointStore,
  PermissionManager, SqliteSessionStorage,
  AgentForgeError, RecoverableError, FatalError, AuthError, ModelNotFoundError, ToolExecutionError,
  TiktokenCounter,
} from '@primo-ai/core';
```

### Agent

顶层 Agent 编排器。

```ts
const agent = new Agent(config: AgentConfig, options?: { tracer?: Tracer });
```

**方法：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `use` | `(factory: PluginFactory) => void` | 加载插件 |
| `run` | `(input: string, signal?: AbortSignal) => Promise<AgentRunResult>` | 运行并返回 `{ response, tokenUsage, sessionId }` |
| `stream` | `(input: string, signal?: AbortSignal) => AsyncIterable<string>` | 流式运行，逐文本片段返回 |
| `streamEvents` | `(input: string, signal?: AbortSignal) => AsyncIterable<StreamEvent>` | 流式运行，逐事件返回 |
| `resume` | `(sessionId: string) => Promise<AgentRunResult>` | 从挂起点恢复运行 |
| `continue` | `(sessionId: string, message: string, signal?: AbortSignal) => Promise<AgentRunResult>` | 在已有会话中追加消息并继续运行 |
| `continueStream` | `(sessionId: string, message: string, signal?: AbortSignal) => AsyncIterable<StreamEvent>` | 继续已有会话的流式运行 |
| `abort` | `() => void` | 中止正在运行的 Agent（幂等，非运行态调用无副作用） |

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `pipelineRunner` | `PipelineRunner` | 内部 pipeline 运行器 |
| `toolRegistry` | `ToolRegistry` | 工具注册表 |
| `pluginManager` | `PluginManager` | 插件管理器 |
| `eventSystem` | `EventSystem` | 事件系统（EventBus + 重放） |
| `state` | `AgentState` | Agent 生命周期状态（`pending`/`running`/`paused`/`completed`/`cancelled`/`error`） |

### PipelineRunner

执行 Processor 链。

```ts
const runner = new PipelineRunner(options?: PipelineRunnerOptions);
```

**方法：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `register` | `(processor: Processor) => void` | 注册 Processor |
| `run` | `(context: PipelineContext, stages: PipelineStage[]) => Promise<PipelineContext>` | 顺序执行阶段 |
| `stream` | `(context: PipelineContext, stages: PipelineStage[]) => AsyncIterable<StreamEvent>` | 流式执行阶段 |

### LLMInvoker

封装 AI SDK `streamText()` 的单步 LLM 调用。

```ts
const invoker = new LLMInvoker(options: LLMInvokerOptions);
```

**方法：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `invoke` | `(input: LLMInvokeInput) => Promise<LLMInvokeResult>` | 同步调用 |
| `stream` | `(input: LLMInvokeInput) => LLMStreamHandle` | 流式调用 |

### ToolRegistry

工具注册与执行。

```ts
const registry = new ToolRegistry(options?: ToolRegistryOptions);
```

**方法：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `register` | `(tool: ToolDefinition) => void` | 注册工具 |
| `unregister` | `(name: string) => void` | 移除工具 |
| `get` | `(name: string) => ToolDefinition \| undefined` | 获取工具 |
| `getAll` | `() => ToolDefinition[]` | 获取所有工具 |
| `toAiSdkToolSchemas` | `() => AiSdkToolSchema[]` | 转为 AI SDK schema（不含 execute） |
| `executeTool` | `(name: string, args: unknown, context?) => Promise<unknown>` | 执行工具 |
| `addBeforeHook` | `(hook: ToolHook) => void` | 添加 before hook |
| `addAfterHook` | `(hook: ToolHook) => void` | 添加 after hook |

### Session 类

#### `FilesystemSessionStorage`

JSONL 文件存储：

```ts
const storage = new FilesystemSessionStorage(basePath: string);
```

#### `SqliteSessionStorage`

基于 better-sqlite3 的 SQLite 会话存储（可选依赖）：

```ts
import { SqliteSessionStorage } from '@primo-ai/core';

const storage = new SqliteSessionStorage('./sessions.db');
```

实现 `SessionStorage` 全部 7 个方法，含 `getMessages()` 支持分页。WAL 模式，支持并发读。

> **安装**: `npm install better-sqlite3`（可选）

#### `SessionPersistence`

桥接 EventBus 事件到 SessionStorage：

```ts
const persistence = new SessionPersistence(bus: EventBus, storage: SessionStorage);
```

#### `SessionManagerImpl`

```ts
const sessionMgr = new SessionManagerImpl(storage: SessionStorage, bus: EventBus);
```

### ConfigLoader

JSONC 多层配置加载：

```ts
const loader = new ConfigLoader(options?: { basePath?: string });
const config = await loader.load({
  env: 'AGENTFORGE_CONFIG',
  project: '.agentforge/config.jsonc',
  session: sessionLevelConfig,
});
```

### Processors

8 个内置 Processor，通过工厂函数创建：

| 导出 | 工厂/单例 | Stage | 说明 |
|------|-----------|-------|------|
| `processInputProcessor` | 单例 | `processInput` | 解析 Dynamic 配置 |
| `createBuildContextProcessor(registry)` | 工厂 | `buildContext` | 构建 systemPrompt、toolDeclarations |
| `createPrepareStepProcessor(registry)` | 工厂 | `prepareStep` | 裁剪历史、刷新工具声明 |
| `createInvokeLLMProcessor(deps)` | 工厂 | `invokeLLM` | 调用 LLM、应用 compat 规则 |
| `processStepOutputProcessor` | 单例 | `processStepOutput` | 追加 assistant 消息到历史 |
| `createExecuteToolsProcessor(registry)` | 工厂 | `executeTools` | 执行待处理工具调用 |
| `evaluateIterationProcessor` | 单例 | `evaluateIteration` | 设置循环指令、token 溢出保护 |
| `processOutputProcessor` | 单例 | `processOutput` | 透传（扩展点） |

### Gateways

#### `GatewayChain`

> **注意**: `GatewayChain` 未从 barrel `index.ts` 导出。内部使用，通过 `ModelFactory` 间接访问。

有序网关链，先匹配先使用：

```ts
// 内部使用 — 通过 ModelFactory 访问
const chain = new GatewayChain();
chain.register(customGateway);
chain.register(new BuiltInGateway());
const model = await chain.resolve('deepseek/deepseek-v4-flash');
const gateways = chain.listGateways(); // Array<{ name: string }>
```

- `listGateways()` — 列出已注册的网关名称

#### `BuiltInGateway`

内置支持：`openai/*`, `anthropic/*`, `google/*`, `deepseek/*`

> **注意**: `BuiltInGateway` 未从 barrel `index.ts` 导出。内部使用。

#### `OpenAICompatibleGateway`

自定义 OpenAI 兼容端点：

```ts
const gateway = new OpenAICompatibleGateway({
  name: 'my-provider',
  url: 'https://api.example.com/v1',
  apiKey: 'sk-xxx',
});
```

### Provider Capabilities

```ts
import { detectProvider, detectCapabilities } from '@primo-ai/core';

const provider = detectProvider('deepseek/deepseek-v4-flash'); // 'deepseek'
const caps = detectCapabilities('deepseek/deepseek-v4-flash');
// { supportsReasoning: true, supportsToolCalling: true, ... }
```

6 个内置 CompatRule：
- `strip-unsupported-reasoning` — 非推理模型移除 reasoning 部分
- `strip-foreign-reasoning` — Anthropic 移除 reasoning
- `ensure-alternating-roles` — Anthropic 插入填充消息
- `fix-empty-assistant-content` — 空内容填充空格
- `sanitize-tool-call-ids` — 修复非法 tool call ID 字符（响应式）
- `deepseek-reasoning-required` — DeepSeek 添加空 reasoningContent（响应式）

### 工具函数

| 函数 | 签名 | 说明 |
|------|------|------|
| `resolveModel` | `(modelString: string) => Promise<LanguageModel>` | ~~@deprecated~~ 解析 "provider/model" 为 AI SDK 模型。推荐使用 `ModelFactory` |
| `registerProvider` | `(name: string, factory: ProviderFactory) => void` | 注册自定义 provider |
| `parseModel` | `(modelString: string) => ParsedModel` | 解析为 `{provider, modelId}` |
| `streamWithRetry` | `<T>(fn, options) => Promise<T>` | 指数退避重试 |
| `deepMerge` | `(target, ...sources) => Record<string, unknown>` | 非变更式深度合并 |
| `resolveDynamic` | `<T>(value: Dynamic<T>, ctx) => Promise<T>` | 解析 Dynamic 值 |
| `matchProfile` | `(model, profiles) => ModelProfile \| undefined` | 匹配 ModelProfile |
| `applyProfile` | `(ctx, profile) => PipelineContext` | 应用 Profile 到上下文 |

### Adapters — 高层 Processor API

提供简化 Processor 开发的高层工厂函数。

```ts
import { modifiers, gates, AbortControlFlow, SuspendControlFlow } from '@primo-ai/core';
```

#### `modifiers` — 上下文修改器

创建简单修改上下文的 Processor：

```ts
// 修改消息历史
const addContext = modifiers.message((msgs, ctx) => [
  { role: 'user', content: `Context: ${ctx.request.metadata.context}` },
  ...msgs,
]);

// 修改 system prompt
const addTimestamp = modifiers.systemPrompt((prompt, ctx) =>
  `${prompt}\n\nCurrent time: ${new Date().toISOString()}`
);

// 修改工具声明
const addAdminTools = modifiers.tools((tools, ctx) =>
  ctx.request.metadata.isAdmin ? [...tools, adminTool] : tools
);

// 修改 provider options
const setTemperature = modifiers.providerOptions((opts, ctx) => ({
  ...opts,
  openai: { temperature: 0.7 },
}));
```

| 工厂 | Stage | 说明 |
|------|-------|------|
| `modifiers.message(fn)` | `invokeLLM` | 修改 `session.messageHistory` |
| `modifiers.systemPrompt(fn)` | `buildContext` | 修改 `agent.config.systemPrompt` |
| `modifiers.tools(fn)` | `prepareStep` | 修改 `agent.toolDeclarations` |
| `modifiers.providerOptions(fn)` | `invokeLLM` | 修改 `agent.providerOptions` |

#### `gates` — 流程控制门

创建控制 pipeline 流程的 Processor：

```ts
// 权限门控
const permissionGate = gates.permission({
  check: (toolName, args, ctx) => {
    if (dangerousTools.includes(toolName)) return 'ask';    // 挂起等待审批
    if (blockedTools.includes(toolName)) return 'deny';     // 中止
    return 'allow';                                         // 继续
  },
  onDeny: (toolName) => `Tool '${toolName}' is not allowed`,
});

// Token 配额门控
const quotaGate = gates.quota({
  check: (usage, ctx) => !usage || usage.input + usage.output < 10000,
  onExceeded: (usage) => `Token quota exceeded`,
});

// 成本门控
const costGate = gates.cost({
  maxCost: 1.0,
  calculateCost: (usage, model) => {
    const rates = { 'gpt-4': { input: 0.03, output: 0.06 } };
    const r = rates[model] ?? { input: 0.001, output: 0.002 };
    return (usage.input * r.input + usage.output * r.output) / 1000;
  },
});
```

| 工厂 | Stage | 说明 |
|------|-------|------|
| `gates.permission(config)` | `gateTool` | 工具调用权限检查，返回 `allow/deny/ask` |
| `gates.quota(config)` | `gateLLM` | Token 配额检查 |
| `gates.cost(config)` | `gateLLM` | 成本上限检查 |

#### `AbortControlFlow` / `SuspendControlFlow`

控制流错误类，由 `ctx.control.abort()/suspend()` 抛出：

```ts
import { AbortControlFlow, SuspendControlFlow, isAbortControlFlow, isSuspendControlFlow } from '@primo-ai/core';

try {
  ctx.control.abort('reason');
} catch (e) {
  if (isAbortControlFlow(e)) {
    console.log(e.reason, e.retryFrom);
  }
}
```

### 并发与容错

#### `ConcurrencyController`

命名信号量槽位管理：

```ts
const controller = new ConcurrencyController([
  { key: 'research', maxConcurrent: 3 },
]);
await controller.acquire('research');
```

#### `FallbackRunner`

有序模型回退链：

```ts
const runner = new FallbackRunner({
  fallbacks: [
    { model: 'openai/gpt-4o', priority: 1 },
    { model: 'anthropic/claude-sonnet-4-6', priority: 2 },
  ],
});
```

### Sub-Agent

#### `createSubAgentTool`

创建子 Agent 工具：

```ts
const researchTool = createSubAgentTool({
  name: 'researcher',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: '你是一个研究助手',
  contextPolicy: 'isolated',
  maxIterations: 3,
}, parentAgent);
```

#### `TaskManagerImpl`

异步子 Agent 任务管理：

```ts
const taskMgr = new TaskManagerImpl();
const handle = await taskMgr.launch(config, prompt);
handle.on_complete((result) => console.log(result.response));
```

### ModelFactory

模型解析的唯一规范路径（可实例化、可注入）。

```ts
const factory = new ModelFactory({ tracer });
const model = await factory.resolve('deepseek/deepseek-v4-flash');
const gateways = factory.listGateways(); // Array<{ name: string; canResolve: (model: string) => boolean }>
```

替代已废弃的 `resolveModel()` 函数。支持实例化注入和测试替换。`listGateways()` 返回已注册网关的元数据。

### StateMachine

Agent 生命周期状态机。

```ts
const sm = new StateMachine();
sm.transition('running');     // pending → running
sm.transition('completed');   // running → completed
sm.reset();                   // 终态 → pending（支持多次 run()）
```

状态：`pending` → `running` → `completed` | `paused` | `cancelled` | `error`

### LoopOrchestrator

从 Agent 提取的循环编排逻辑，`run()` 和 `stream()` 共享。

```ts
const orchestrator = new LoopOrchestrator({
  pipelineRunner,
  stateMachine,
  eventSystem,
  hookManager,
  toolRegistry,
  llmInvoker,
  contextBuilder,
  modelFactory,
});
```

处理 abort、retry、compat 规则应用、suspend checkpoint。

### ContextBuilder

上下文组装模块。

```ts
const builder = new ContextBuilder({ modelFactory, toolRegistry });
const context = builder.assemble(config, input, sessionId);
```

### EventSystem

EventBus + 事件重放。

```ts
const eventSystem = new EventSystem();
eventSystem.emit('agent.start', { input });
eventSystem.subscribe('tool.after', (event) => { /* ... */ });
```

#### `EventBus`

```ts
class EventBus {
  subscribe(eventType: string, handler: (data: unknown) => void): () => void;
  once(eventType: string): Promise<unknown>;
  emit(eventType: string, data: unknown): void;
}
```

- `subscribe()` — 持久订阅，返回取消订阅函数
- `once()` — 单次订阅，首次事件后自动取消，返回 Promise
- `emit()` — 发送事件到所有订阅者

### HookManager

12 个拦截点的轻量级钩子系统。

```ts
const hookManager = new HookManager();
hookManager.register('llm.before', async (ctx) => { /* 修改 prompt */ });
hookManager.register('tool.after', async (ctx) => { /* 日志记录 */ });
```

### CheckpointStore

Suspend/Resume 的检查点持久化。

#### `InMemoryCheckpointStore`

内存存储，适用于测试和短期会话：

```ts
const store = new InMemoryCheckpointStore();
```

#### `JsonlCheckpointStore`

JSONL 文件存储，适用于生产持久化：

```ts
const store = new JsonlCheckpointStore({ dir: './checkpoints' });
```

### 序列化

```ts
import { serialize, deserialize } from '@primo-ai/core';

// Suspend 时序列化上下文
const checkpoint = serialize(context);

// Resume 时反序列化
const restored = deserialize(checkpoint);
```

### PermissionManager

权限审批管理器，用于交互式模式下的人机审批。

```ts
import { PermissionManager } from '@primo-ai/core';

const pm = new PermissionManager();
```

**方法：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `awaitDecision` | `(permission: PendingPermission) => Promise<boolean>` | 等待审批决策，返回 `true`(批准) 或 `false`(拒绝) |
| `resolve` | `(permissionId: string, approved: boolean) => void` | 服务器端解析审批请求 |
| `list` | `() => PendingPermission[]` | 列出所有待审批权限请求 |
| `getBySession` | `(sessionId: string) => PendingPermission[]` | 按会话过滤待审批请求 |
| `get` | `(permissionId: string) => PendingPermission \| undefined` | 获取单个权限请求详情 |

**类型：**

```ts
interface PendingPermission {
  permissionId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  createdAt: string;
}
```

### 错误体系

领域错误层次结构：

```
AgentForgeError (base)
├── RecoverableError
│   └── ToolExecutionError
└── FatalError
    ├── AuthError
    └── ModelNotFoundError
```

```ts
try {
  const result = await agent.run(input);
} catch (e) {
  if (e instanceof AuthError) { /* API Key 无效 */ }
  if (e instanceof ModelNotFoundError) { /* 模型不存在 */ }
  if (e instanceof ToolExecutionError) { /* 工具执行失败，可重试 */ }
  if (e instanceof RecoverableError) { /* 可恢复错误 */ }
  if (e instanceof FatalError) { /* 不可恢复 */ }
}
```

### SyncEvent 事件溯源

事件溯源模块，支持 `InMemory` 和 `Jsonl` 两种存储后端。

```ts
import {
  InMemorySyncEventStore,
  JsonlSyncEventStore,
  VersionMismatchError,
  type SyncEvent,
  type SyncEventStore,
} from '@primo-ai/core';
```

#### `SyncEvent<T>`

```ts
interface SyncEvent<T = unknown> {
  readonly version: number;      // 事件 schema 版本
  readonly aggregateId: string;  // 聚合标识符
  readonly seq: number;          // 单调递增序列号（聚合内无间隔）
  readonly timestamp: number;    // Unix 毫秒时间戳
  readonly type: string;         // 事件类型鉴别符
  readonly payload: T;           // 事件载荷
}
```

#### `SyncEventStore<T>`

```ts
interface SyncEventStore<T = unknown> {
  append(aggregateId: string, type: string, payload: T, version?: number): Promise<SyncEvent<T>>;
  replay(aggregateId: string, fromSeq?: number, expectedVersion?: number): AsyncGenerator<SyncEvent<T>>;
  getLastSeq(aggregateId: string): Promise<number>;
}
```

- `append()` — 原子追加事件，自动分配下一个序列号
- `replay()` — 按序列号顺序重放事件，支持 `expectedVersion` 校验
- `getLastSeq()` — 返回聚合的最新序列号（无事件返回 0）

#### `InMemorySyncEventStore`

内存存储，适用于测试和短期场景：

```ts
const store = new InMemorySyncEventStore<MyPayload>();
const event = await store.append('agg-1', 'created', { name: 'test' });
for await (const e of store.replay('agg-1')) { /* ... */ }
```

#### `JsonlSyncEventStore`

JSONL 文件存储，适用于生产持久化：

```ts
const store = new JsonlSyncEventStore<MyPayload>('./events');
const event = await store.append('agg-1', 'created', { name: 'test' });
```

通过原子 rename（先写 `.tmp` 再 rename）保证写入完整性。

#### `VersionMismatchError`

```ts
class VersionMismatchError extends Error {
  readonly aggregateId: string;
  readonly expected: number;
  readonly actual: number;
}
```

在 `replay()` 中指定 `expectedVersion` 时，若遇到版本不匹配的事件则抛出。

### TiktokenCounter

基于 tiktoken 的 token 计数器。

```ts
const counter = new TiktokenCounter();
const tokens = counter.count('Hello world'); // → number
```

---

## @primo-ai/server — HTTP 服务器

```ts
import {
  AgentForgeServer, AgentRegistry, AgentForgeClient,
  SessionEventStream,
  StaticKeyAuthAdapter, serializeSSE, parseSSE,
  InMemoryTaskStore, buildAgentCard, A2ARequestHandler, A2AClient, a2aRoutes,
  studioRoutes, studioStaticRoutes,
  ProfileLoader, mergeProfiles, applyProfile, builtinProfiles,
  codingAgentProfile, businessAgentProfile, personalAgentProfile, dataAgentProfile,
} from '@primo-ai/server';
```

### AgentForgeServer

Hono HTTP 服务器。

```ts
const server = new AgentForgeServer({
  port: 3000,
  auth: new StaticKeyAuthAdapter('secret'),
  // 可选：注入共享依赖
  permissionManager: new PermissionManager(),
  modelFactory: new ModelFactory({}),
  mcpManager: new McpManager(),
  sessionStorage: 'sqlite',          // 'file' | 'sqlite'
  storagePath: './data/sessions.db',
});
await server.start();
```

`ServerOptions` 可选依赖：
| 选项 | 类型 | 说明 |
|------|------|------|
| `permissionManager` | `PermissionManager` | 共享的权限管理器实例 |
| `modelFactory` | `ModelFactory` | 共享的模型工厂实例 |
| `mcpManager` | `McpManager` | 共享的 MCP 管理器实例 |
| `sessionStorage` | `'file' \| 'sqlite'` | 会话存储后端（默认 `'file'`） |
| `storagePath` | `string` | 存储路径（文件模式为目录，SQLite 为 db 路径） |

### AgentRegistry

Agent 注册表，含 Session→Agent 反向映射。

```ts
const registry = new AgentRegistry();
registry.register('assistant', agentConfig);
registry.registerSession('session-1', 'assistant');  // 记录 session→agent 映射
const agent = registry.getAgentBySession('session-1'); // 按 session 查找 Agent
registry.unregisterSession('session-1');              // 清除映射
```

### SessionEventStream

SSE 事件流基础设施，用于长连接订阅 session 事件。

```ts
import { SessionEventStream } from '@primo-ai/server';

const stream = new SessionEventStream(registry);
const readable = stream.subscribe('session-1');         // 订阅会话事件 SSE
const readable2 = stream.fromAgentContinue('agent-1', 'session-1', '请继续'); // Agent continue + SSE
```

### HTTP API 端点

#### 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health/live` | 存活检查，进程是否在运行 |
| `GET` | `/health/ready` | 就绪检查，是否能服务请求（至少一个 Agent 已注册） |

#### Agent 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/agents` | 列出所有已注册 Agent |
| `GET` | `/agents/:id` | 获取 Agent 状态（`{ id, state }`） |
| `POST` | `/agents/:id/run` | 同步运行 Agent，返回 `AgentRunResult` |
| `POST` | `/agents/:id/stream` | SSE 流式运行（`?mode=events` 返回结构化事件，默认文本流） |
| `POST` | `/agents/:id/resume` | 从 sessionId 恢复运行 |

#### Session 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/sessions` | 列出所有会话 |
| `GET` | `/sessions/status` | 批量获取活跃会话状态 |
| `GET` | `/sessions/:id` | 获取指定会话 |
| `GET` | `/sessions/:id/messages` | 获取消息历史（`?limit=50&before=msg_xxx` 分页） |
| `GET` | `/sessions/:id/events` | SSE 订阅会话事件（长连接） |
| `POST` | `/sessions/:id/abort` | 中止正在运行的会话 |
| `POST` | `/sessions/:id/prompt` | 在已有会话中追加消息（同步返回最终结果） |
| `POST` | `/sessions/:id/prompt/stream` | 在已有会话中追加消息（SSE 流式） |
| `DELETE` | `/sessions/:id` | 删除会话及其所有事件 |

#### 权限管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/permissions/pending` | 列出所有待审批权限请求 |
| `GET` | `/permissions/pending/:permissionId` | 获取单个权限请求详情 |
| `POST` | `/permissions/pending/:permissionId/respond` | 批准或拒绝权限请求 `{ approved: boolean }` |

#### Provider 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/providers` | 列出已注册的网关及模型提示 |
| `GET` | `/providers/models` | 列出可用模型模式（网关名称 + canResolve 提示） |

#### MCP 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/mcp` | 列出 MCP 服务器状态 |
| `GET` | `/mcp/:name/tools` | 列出指定服务器的工具 |
| `POST` | `/mcp` | 运行时添加 MCP 服务器 |
| `DELETE` | `/mcp/:name` | 移除 MCP 服务器 |
| `POST` | `/mcp/:name/reconnect` | 重新连接 MCP 服务器 |

**请求体**（run/stream）：

```json
{
  "input": "string (required, non-empty)",
  "sessionId": "string (optional)"
}
```

**请求体**（resume）：

```json
{
  "sessionId": "string (required)"
}
```

### Studio Observability

`StudioObservability` 是 server-level 的可观测性采集器，桥接 Agent EventBus 到 Trace/Metrics 收集器，为 Studio UI 提供数据源。

```ts
import { StudioObservability } from '@primo-ai/server';
import type { StudioObservability as StudioObservabilityType } from '@primo-ai/server';

const obs = new StudioObservability();

// 订阅 Agent 事件 — 自动收集 trace 和 metrics
obs.attachAgent(agent);

// 查询
const traces = obs.getTraces({ status: 'completed', agentName: 'assistant' });
const trace = obs.getTrace('session-123');        // TraceDetail with span tree
const metrics = obs.getMetricsSnapshot();          // MetricsSnapshot
const kpi = obs.getKpi({ since: Date.now() - 3600000 }); // KpiData (last hour)
```

**方法：**

| 方法 | 签名 | 说明 |
|------|------|------|
| `attachAgent` | `(agent: { eventBus; name? }) => () => void` | 订阅 Agent 事件，返回取消订阅函数 |
| `getTraces` | `(filter?) => TraceSummary[]` | 列表查询，支持 agentName/status/since/until 过滤 |
| `getTrace` | `(id: string) => TraceDetail \| undefined` | 获取单个 Trace（含 Span 树和扁平 spans 列表） |
| `getMetricsSnapshot` | `() => MetricsSnapshot` | 获取当前指标快照 |
| `getKpi` | `(period?) => KpiData` | 计算 KPI（totalRuns/avgLatency/totalTokens/estimatedCost） |

**Studio 路由集成：**

```ts
// server.ts 中条件挂载
if (options?.studio) {
  app.route('/api/studio', studioRoutes({
    observability: options.studio,
    sessionStorage: sessionStorage,
    registry: registry,
  }));
  app.route('/studio', studioStaticRoutes());
}
```

### Studio API 端点

当启用 `--studio` 标志时，以下端点可用：

#### Traces

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/studio/traces` | 列出所有 Trace 摘要，支持 `?status, ?agent, ?limit, ?offset` |
| `GET` | `/api/studio/traces/:id` | Trace 详情（含 rootSpan SpanNode 树和 spans 平面列表） |

#### Metrics

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/studio/metrics` | 返回 `MetricsSnapshot`（counters, gauges, histograms） |
| `GET` | `/api/studio/metrics/kpi` | KPI 数据，支持 `?since, ?until` 时间范围过滤 |

#### Sessions (Studio)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/studio/sessions` | 列出会话，支持 `?status, ?limit, ?offset` |
| `GET` | `/api/studio/sessions/:id` | 会话详情 |
| `GET` | `/api/studio/sessions/:id/events` | 会话事件流，支持 `?fromSeq, ?toSeq, ?types` |

#### Agents (Studio)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/studio/agents` | 列出已注册 Agent（含 model 信息） |

#### 静态资源

| 路径 | 说明 |
|------|------|
| `/studio/*` | 嵌入式 Studio SPA（Vue 3），提供 Dashboard / Traces / Sessions 可视化界面 |

### A2A Protocol

Google Agent-to-Agent 协议支持。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/.well-known/agent-card.json` | Agent 能力声明 |
| `POST` | `/jsonrpc` | JSON-RPC 2.0 A2A 请求 |

---

## @primo-ai/tools — 内置工具

```ts
import {
  echoTool, httpTool, fileReadTool, fileWriteTool, fileEditTool,
  globTool, grepTool, shellTool, calculatorTool, datetimeTool, jsonTool,
} from '@primo-ai/tools';
```

| 工具 | 输入 Schema | 输出 | 说明 | 需审批 |
|------|------------|------|------|--------|
| `echoTool` | `{ message: z.string() }` | `string` | 回显输入消息 | 否 |
| `httpTool` | `{ url, method?, headers?, body? }` | `{ status, headers, body }` | HTTP 请求 (GET/POST/PUT/PATCH/DELETE) | 否 |
| `fileReadTool` | `{ path, encoding?, offset?, limit? }` | `{ content, lines, path }` | 读取文件，支持行范围 | 否 |
| `fileWriteTool` | `{ path, content, encoding?, append? }` | `{ path, bytes }` | 写入文件，自动创建目录 | 是 |
| `fileEditTool` | `{ path, oldString, newString, replaceAll? }` | `{ path, replacements }` | 精确字符串替换 | 是 |
| `globTool` | `{ pattern, path? }` | `{ files, count }` | 文件模式匹配查找 | 否 |
| `grepTool` | `{ pattern, path?, include?, maxResults? }` | `{ matches, count }` | 正则搜索文件内容 | 否 |
| `shellTool` | `{ command, cwd?, timeout? }` | `{ exitCode, stdout, stderr }` | 执行 Shell 命令 | 是 |
| `calculatorTool` | `{ expression }` | `{ result, expression }` | 数学表达式求值 | 否 |
| `datetimeTool` | `{ format?, timezone? }` | `{ iso, formatted, timezone, unix }` | 获取当前日期时间 | 否 |
| `jsonTool` | `{ operation, data, path?, indent? }` | `{ result }` | JSON 解析/格式化/路径查询 | 否 |

---

## @primo-ai/observability — 可观测性

```ts
import {
  OTelBridge, TracerImpl, NoOpTracer, NoOpMetrics, NoOpSpan,
  SpanImpl, TestExporter,
  InMemoryMetrics, TraceCollector,
  formatTraceJson, formatTraceConsole, formatTraceOtlp,
} from '@primo-ai/observability';
```

### 核心类

| 导出 | 类型 | 说明 |
|------|------|------|
| `NoOpTracer` | 类 | 零操作 Tracer，用于不追踪的场景 |
| `NoOpSpan` | 类 | 零操作 Span |
| `NoOpMetrics` | 类 | 零操作 Metrics |
| `TracerImpl` | 类 | 具体 Tracer 实现 |
| `SpanImpl` | 类 | 具体 Span 实现 |
| `OTelBridge` | 类 | OpenTelemetry SDK 桥接 |
| `TestExporter` | 类 | 测试用 Span 导出器 |
| `InMemoryMetrics` | 类 | 内存 Metrics 实现（Counter/Gauge/Histogram） |
| `TraceCollector` | 类 | Trace 收集器 — 创建 Tracer，flush 生成 Span 树 |

### 类型

| 导出 | 说明 |
|------|------|
| `SpanData` | Span 数据接口（name, spanId, durationMs, attributes, events） |
| `OnSpanEndCallback` | Span 结束回调类型 |
| `HistogramStats` | 直方图统计（count, sum, min, max, avg, p50, p95, p99） |
| `MetricsSnapshot` | 指标快照（counters, gauges, histograms） |
| `Trace` | Trace 记录 |
| `TraceNode` | Trace 树节点 |
| `OtlpOptions` | OTLP 格式化选项 |
| `EventBusLike` | EventBus 兼容接口（用于 OTelBridge） |

### InMemoryMetrics

```ts
const metrics = new InMemoryMetrics();

metrics.increment('runs.completed');            // Counter +1
metrics.increment('tokens.input', 1500);         // Counter +N
metrics.gauge('agents.active', 3);               // Gauge 设置
metrics.histogram('latency', 250);               // Histogram 记录

const snap: MetricsSnapshot = metrics.snapshot();
// { counters: { 'runs.completed': 5, ... }, gauges: { ... }, histograms: { ... } }
```

### TraceCollector

```ts
const collector = new TraceCollector();
const tracer = collector.createTracer();

// 创建 Span 树
const root = tracer.startSpan('agent.run');
const step = root.startChild('invokeLLM');
step.setAttribute('model', 'deepseek/deepseek-v4-flash');
step.end();
root.end();

// Flush 得到结构化的 Trace 数据
const flushed = collector.flush();
// { spans: SpanData[], root: SpanNode, durationMs: number }

// 格式化输出
console.log(formatTraceConsole(flushed));
const json = formatTraceJson(flushed);
const otlp = formatTraceOtlp(flushed);
```

### OTelBridge 用法

```ts
import { OTelBridge } from '@primo-ai/observability';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

const tracer = new OTelBridge({ tracerProvider: provider, eventBus: bus });
```

---

## @primo-ai/plugins — 官方插件

```ts
import {
  memoryPlugin, compressionPlugin, evictionPlugin,
  permissionPlugin, skillPlugin, mcpPlugin,
  McpManager,
} from '@primo-ai/plugins';
```

### memoryPlugin

会话记忆存储与检索。

```ts
agent.use(memoryPlugin({
  backend: new InMemoryBackend(),  // 或 SQLiteBackend
  triggerMode: { type: 'automatic', onLoad: 'always' },
}));
```

**triggerMode 选项：**
- `{ type: 'automatic', onLoad: 'always' | 'on-session-start' }` — 自动注入记忆
- `{ type: 'agent-controlled' }` — 注册 `retrieve_from_memory` / `record_to_memory` 工具
- `{ type: 'both' }` — 同时自动注入和提供工具

**后端：** `InMemoryBackend` | `SQLiteBackend`

### compressionPlugin

上下文压缩，防止 token 溢出。

```ts
agent.use(compressionPlugin({
  maxContextTokens: 8000,
  phases: [
    { type: 'truncate', maxTokens: 500 },
    { type: 'summarize', model: 'deepseek/deepseek-v4-flash', maxTokens: 2000 },
    { type: 'prune', keepRecent: 10 },
  ],
  // 可选：注入自定义 LLM 调用器（自动创建 summarizeFn）
  getLLM: (model) => ({ invoke: async (input) => ({ response: 'summary', tokenUsage: null }) }),
  summarizeModel: 'deepseek/deepseek-v4-flash',
}));
```

**阶段按顺序执行，满足条件后停止。**

**`summarizeFn` 选项：**

每个 `summarize` phase 可指定自定义 `summarizeFn`：
```ts
import { createSummarizeFn, type SummarizeFn } from '@primo-ai/plugins';

const customFn: SummarizeFn = async (messages) => {
  // 自定义摘要逻辑
  return '摘要内容';
};

agent.use(compressionPlugin({
  phases: [
    { type: 'summarize', model: 'gpt-4o', maxTokens: 2000, summarizeFn: customFn },
  ],
}));
```

也可通过 `getLLM` 选项自动创建内置的 `createSummarizeFn`。`createSummarizeFn(getLLM, model?)` 通过 system prompt 引导 LLM 生成结构化摘要。

### evictionPlugin

大工具输出自动驱逐。

```ts
agent.use(evictionPlugin({
  maxSize: 500,                      // 超过此大小的工具输出被驱逐
  storage: new InMemoryEvictionStorage(),
  previewLength: 200,                // 驱逐后保留的预览长度
}));
```

驱逐后工具结果替换为 `{ preview, reference, evicted: true }`，可通过 `EvictionStorage` 检索完整内容。

### permissionPlugin

工具执行权限控制。

```ts
agent.use(permissionPlugin({
  mode: 'interactive',  // 'full-auto' | 'plan-only' | 'interactive'
  rules: [
    { tool: 'shell_exec', action: 'deny' },
    { tool: 'file_write', action: 'ask' },
    { tool: 'echo', action: 'allow' },
  ],
  permissionManager: new PermissionManager(),  // 可选：交互式审批
}));
```

**模式：**
- `full-auto` — 所有工具允许
- `plan-only` — 危险工具自动拒绝
- `interactive` — 按规则评估，`ask` 规则通过 `PermissionManager.awaitDecision()` 等待人工审批（提供时）或 fallback 到 suspend 行为（未提供时）

### skillPlugin

基于 SKILL.md 文件的技能发现与注入。

```ts
agent.use(skillPlugin({
  skills: [{ name: 'summarize', description: '文本摘要', content: '...' }],
  // 或自动发现:
  directories: ['./skills', './.skills'],
}));
```

注册 `read_skill` 工具供 Agent 按需读取技能内容。

### mcpPlugin

Model Context Protocol 服务器集成。

```ts
agent.use(mcpPlugin({
  servers: [{
    name: 'filesystem',
    transport: 'stdio',
    command: 'node',
    args: ['server-entry.js', '/path/to/dir'],
  }],
}));
```

MCP 工具名自动添加 `serverName__` 前缀防止冲突。生命周期通过 `ResourceDeclaration` 管理：`start()` 连接并发现工具，`stop()` 断开并注销。

#### `McpManager`

运行时 MCP 服务器管理类：

```ts
import { McpManager } from '@primo-ai/plugins';

const manager = new McpManager();
await manager.addServer({ name: 'filesystem', transport: 'stdio', command: 'node', args: ['server.js'] });
const status = manager.listServers(); // McpServerStatus[]
await manager.removeServer('filesystem');
await manager.reconnect('filesystem');
```

通过 `/mcp` 路由暴露管理 API，支持运行时添加/移除/重连 MCP 服务器。

### Harness Processors

实验性的控制/观测专用处理器：

```ts
import {
  createFactInjectionProcessor, createGoalEchoProcessor,
  createTokenBudgetProcessor, createCostCapProcessor,
  setGateDecision, setCostAttributes, setBudgetAttributes,
} from '@primo-ai/plugins';
```

| 导出 | 说明 |
|------|------|
| `createFactInjectionProcessor` | 在关键推理节点注入外部事实 |
| `createGoalEchoProcessor` | 目标回显，防止 Agent 偏离 |
| `createTokenBudgetProcessor` | Token 预算控制 |
| `createCostCapProcessor` | 成本上限控制 |
| `setGateDecision` | 设置门控决策属性 |
| `setCostAttributes` | 设置成本属性 |
| `setBudgetAttributes` | 设置预算属性 |
