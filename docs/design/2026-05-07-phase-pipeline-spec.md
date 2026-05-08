# AgentForge v2 — Phase Pipeline 实现规范

> 2026-05-07 | 基于 7 个同级项目对比 + 从零设计

## 目录

1. [核心类型](#1-核心类型)
2. [Phase Pipeline](#2-phase-pipeline)
3. [Agent Loop](#3-agent-loop)
4. [Controls](#4-controls)
5. [TraceContext](#5-tracecontext)
6. [Plugin](#6-plugin)
7. [BackendProtocol](#7-backendprotocol)
8. [Agent 公共接口](#8-agent-公共接口)
9. [包结构](#9-包结构)
10. [迁移路径](#10-迁移路径)

---

## 1. 核心类型

### 1.1 Hook

```typescript
// src/core/phase/types.ts

/** Hook 执行结果 */
type HookResult<T> = T | 'abort' | undefined;

/**
 * 单个 Hook 函数。
 *
 * - 返回 T: 修改后的 ctx，传递给下一个 Hook
 * - 返回 'abort': 终止当前 Phase，不执行后续 Hook
 * - 返回 undefined: 不改动 ctx，继续下一个 Hook
 *
 * Hook 抛出的异常由 Phase Pipeline 静默捕获（插件隔离）。
 */
type HookFn<TCtx> = (
  ctx: TCtx,
  signal: AbortSignal
) => Promise<HookResult<TCtx>>;

/**
 * 一个 Hook 实例。
 *
 * priority 决定在同一 Phase 内的执行顺序 (越小越先执行)。
 * 默认 100，建议使用 HookPriority 常量。
 */
interface Hook<TCtx> {
  name: string;
  priority?: number;
  fn: HookFn<TCtx>;
}

/** 标准优先级常量 */
const HookPriority = {
  MEMORY: 10,      // 记忆注入
  WORKING_MEM: 20, // 工作记忆
  SKILLS: 30,      // 技能注入
  COMPACTION: 40,  // 上下文裁剪
  PERMISSION: 50,  // 权限检查
  RATE_LIMIT: 60,  // 速率限制
  QUALITY_GATE: 70,// 质量门禁
  DEFAULT: 100,    // 用户自定义
} as const;
```

### 1.2 Phase Context Types

```typescript
// src/core/phase/contexts.ts

/** beforeLLM Phase 的上下文 */
interface BeforeLLMCtx {
  messages: Message[];
  tools: ToolDefinition[];
  systemPrompt: string;
  model: ModelConfig;
  state: Readonly<AgentState>;
}

/** afterLLM Phase 的上下文 */
interface AfterLLMCtx {
  messages: Message[];       // 包括刚添加的 assistant message
  response: LLMResponse;
  state: Readonly<AgentState>;
}

/** LLM Chunk —— 只读观察事件 */
interface LLMChunkEvent {
  type: 'text' | 'thinking' | 'toolCall';
  content: string;
  toolCallId?: string;
}

/** beforeTool Phase 的上下文 */
interface BeforeToolCtx {
  toolCall: ToolCall;
  messages: Message[];
  state: Readonly<AgentState>;
  /** Hook 可以修改 args 来改变工具参数 */
  modifyArgs(args: Record<string, unknown>): void;
}

/** afterTool Phase 的上下文 */
interface AfterToolCtx {
  toolCall: ToolCall;
  result: ToolResult;
  state: Readonly<AgentState>;
  /** Hook 可以替换 result */
  replaceResult(result: ToolResult): void;
}

/** onError Phase 的上下文 */
interface ErrorCtx {
  error: SerializedError;
  phase: 'llm' | 'tool' | 'checkpoint';
  attempt: number;          // 当前重试次数
  state: Readonly<AgentState>;
  /** Hook 可以设置恢复策略 */
  setRecovery(action: RecoveryAction): void;
}

/** onCheckpoint Phase 的上下文 */
interface CheckpointCtx {
  action: 'save' | 'restore';
  checkpoint: Checkpoint;
  state: Readonly<AgentState>;
}
```

### 1.3 恢复策略

```typescript
type RecoveryAction =
  | { type: 'retry'; maxAttempts?: number; backoff?: 'exponential' | 'linear' | 'fixed' }
  | { type: 'switchModel'; model: ModelConfig }
  | { type: 'compact' }
  | { type: 'escalate'; reason: string }
  | { type: 'abort'; reason: string };
```

---

## 2. Phase Pipeline

### 2.1 Phase 接口

```typescript
// src/core/phase/pipeline.ts

interface Phase<TCtx> {
  /** Phase 名称，用于调试和 diagnose() */
  readonly name: string;

  /** 注册 Hook */
  hook(h: Hook<TCtx>): () => void;

  /** 批量注册 */
  hooks(hs: Hook<TCtx>[]): void;

  /**
   * 执行 Phase 内所有 Hook，按 priority 排序。
   *
   * 执行模型：
   * 1. 浅拷贝 ctx（每个 Hook 接收前一个 Hook 的返回值）
   * 2. 顺序遍历：如果 Hook 返回 'abort'，终止并返回 { aborted: true }
   * 3. 如果 Hook 返回新的 ctx，替换当前 ctx
   * 4. 如果 Hook 抛异常，静默捕获，继续下一个 Hook
   * 5. Hook 执行前后自动创建 Span（如果 TraceContext 存在）
   *
   * @returns aborted=true 表示被某个 Hook 阻止了
   */
  run(ctx: TCtx, opts?: PhaseRunOptions): Promise<PhaseResult<TCtx>>;
}

interface PhaseRunOptions {
  signal?: AbortSignal;
  trace?: TraceContext;
}

interface PhaseResult<TCtx> {
  ctx: TCtx;            // 最终 ctx（可能被 Hook 修改过）
  aborted: boolean;     // 是否有 Hook 返回了 'abort'
  abortReason?: string; // abort 原因（第一个 abort 的 Hook 名称）
}
```

### 2.2 PhaseRegistry

```typescript
// src/core/phase/pipeline.ts

/**
 * Phase 注册表——管理所有 Phase 的生命周期。
 *
 * 5 个内置 Phase 在 Loop 初始化时自动创建。
 * 用户和 Plugin 通过 AgentBuilder 或 Plugin 接口注册 Hook 到目标 Phase。
 */
class PhaseRegistry {
  // 5 个内置 Phase
  readonly beforeLLM: Phase<BeforeLLMCtx>;
  readonly afterLLM: Phase<AfterLLMCtx>;
  readonly beforeTool: Phase<BeforeToolCtx>;
  readonly afterTool: Phase<AfterToolCtx>;
  readonly onError: Phase<ErrorCtx>;

  // 只读观察 Phase（不修改 ctx，不 abort，fire-and-forget）
  readonly onLLMChunk: ChunkPhase;
  readonly onCheckpoint: ObserverPhase<CheckpointCtx>;
  readonly onCompact: ObserverPhase<CompactCtx>;
  readonly onStateChange: ObserverPhase<StateChangeCtx>;

  /**
   * 注册 Hook 到指定 Phase。返回取消注册函数。
   *
   * @example
   * registry.on('beforeLLM', { name: 'memory', priority: 10, fn: memoryHook });
   */
  on<K extends PhaseName>(phase: K, hook: Hook<PhaseCtx<K>>): () => void;

  /** 从一个 Plugin 注册它所有的 Hook */
  registerPlugin(plugin: Plugin): () => void;
}

type PhaseName = 'beforeLLM' | 'afterLLM' | 'beforeTool' | 'afterTool'
               | 'onError' | 'onLLMChunk' | 'onCheckpoint'
               | 'onCompact' | 'onStateChange';
```

### 2.3 为什么不复用洋葱模型

```
洋葱模型:  m1_before → m2_before → LLM → m2_after → m1_after
           ↑ 单个 async 调用栈，next() 之后才执行 after

Phase Pipeline:  phase('beforeLLM') → LLM → phase('afterLLM')
                 ↑ 两个独立执行，不共享调用栈

选择 Phase Pipeline 的理由：
1. LLM streaming 是多个 chunk 事件——洋葱的 next() 无法表示"流式返回"
2. Loop 中有 2-5 轮对话——洋葱无法跨轮保持上下文
3. abort 信号在洋葱中传播不直观——m2_after 可能因为 abort 永远不执行
4. 调试和 diagnose() 在 Phase Pipeline 中更直接——每个 Phase 有独立的耗时和 Span
```

---

## 3. Agent Loop

### 3.1 双层循环模型

```
┌─────────────────────────────────────────────────────┐
│                Agent Loop (双层)                     │
│                                                      │
│  run(input) {                                        │
│    messages.push(userMessage(input));                │
│    loop();  ← 入口                                   │
│  }                                                   │
│                                                      │
│  loop() {                                            │
│    outer: while (true) {  ← 外层: follow-up queue    │
│                                                      │
│      inner: while (true) {  ← 内层: steering + ReAct │
│        // Steering: 本轮执行中注入                    │
│        drain(steeringQueue);                         │
│                                                      │
│        // Phase: beforeLLM                           │
│        r = phases.beforeLLM.run(ctx);                │
│        if (r.aborted) break outer;                   │
│                                                      │
│        // Phase: LLM call                            │
│        response = await llm.stream(r.ctx.messages);  │
│        for (chunk of response.stream)                │
│          phases.onLLMChunk.emit(chunk);              │
│                                                      │
│        // Phase: afterLLM                            │
│        phases.afterLLM.run({ response, ... });       │
│                                                      │
│        // Tool 执行                                  │
│        if (response.toolCalls.length === 0) break;   │
│                                                      │
│        for (tc of response.toolCalls) {              │
│          // Phase: beforeTool                        │
│          r = phases.beforeTool.run({ toolCall: tc });│
│          if (r.aborted) continue;                    │
│                                                      │
│          result = await executeTool(r.ctx.toolCall);  │
│                                                      │
│          // Phase: afterTool                         │
│          phases.afterTool.run({ result });           │
│        }                                             │
│      }  // end inner                                 │
│                                                      │
│      // Follow-up: Agent 自己停了，检查是否有新任务   │
│      followUps = drain(followUpQueue);               │
│      if (followUps.length === 0) break outer;        │
│      messages.push(...followUps);                    │
│    }  // end outer                                   │
│  }                                                   │
└─────────────────────────────────────────────────────┘
```

### 3.2 实现伪代码

```typescript
// src/loop/agent-loop.ts

async function agentLoop(
  input: string,
  phases: PhaseRegistry,
  controls: AgentControls,
  ctx: AgentContext,
  config: AgentLoopConfig,
): Promise<RunResult> {
  const ac = controls.abortController;
  let state = createInitialState(input, config);

  // 硬中断响应
  controls.onAbort(() => ac.abort());

  // 暂停/恢复
  controls.onPause(async () => {
    await saveCheckpoint(state);
    await controls.waitForResume();
    await restoreCheckpoint(state);
  });

  try {
    // ── 外层：follow-up 循环 ──
    outer: while (!ac.signal.aborted) {
      let hasToolCalls = true;

      // ── 内层：steering + ReAct ──
      while (hasToolCalls && !ac.signal.aborted) {
        ac.signal.throwIfAborted();

        // Steering: 注入本轮消息
        for (const msg of controls.drainSteering()) {
          state.messages.push(msg);
        }

        // Guard: max steps
        if (state.step >= config.maxSteps) break outer;

        // Phase: beforeLLM
        const llmCtx: BeforeLLMCtx = {
          messages: state.messages,
          tools: state.tools,
          systemPrompt: config.systemPrompt,
          model: config.model,
          state,
        };
        const beforeResult = await phases.beforeLLM.run(llmCtx, {
          signal: ac.signal,
          trace: ctx.trace,
        });
        if (beforeResult.aborted) break outer;

        // LLM 调用
        const response = await streamLLM(beforeResult.ctx, ac.signal, ctx.trace);

        // 流式观察
        for (const chunk of response.chunks) {
          phases.onLLMChunk.emit(chunk);
        }

        // Phase: afterLLM
        await phases.afterLLM.run({ messages: response.messages, response, state }, {
          signal: ac.signal,
          trace: ctx.trace,
        });

        // 无 Tool 调用 → 结束内层循环
        if (!response.toolCalls || response.toolCalls.length === 0) {
          hasToolCalls = false;
          break;
        }

        // Tool 执行
        for (const tc of response.toolCalls) {
          ac.signal.throwIfAborted();

          // Phase: beforeTool
          const tcCtx: BeforeToolCtx = {
            toolCall: tc,
            messages: state.messages,
            state,
            modifyArgs: (args) => { tc.args = args; },
          };
          const tcResult = await phases.beforeTool.run(tcCtx, {
            signal: ac.signal,
            trace: ctx.trace,
          });
          if (tcResult.aborted) continue;

          // 执行
          const result = await executeTool(tcResult.ctx.toolCall, ac.signal, ctx.trace);

          // Phase: afterTool
          const atCtx: AfterToolCtx = {
            toolCall: tc,
            result,
            state,
            replaceResult: (r) => { result = r; },
          };
          await phases.afterTool.run(atCtx, {
            signal: ac.signal,
            trace: ctx.trace,
          });

          state.messages.push(createToolResultMessage(result));
        }

        state.step++;
      }

      // Follow-up: Agent 停了，检查是否有新任务
      const followUps = controls.drainFollowUp();
      if (followUps.length === 0) break outer;
      state.messages.push(...followUps);
    }
  } catch (e) {
    if (isAbortError(e)) {
      // Phase: onError
      const errCtx: ErrorCtx = {
        error: serializeError(e),
        phase: 'llm',
        attempt: 0,
        state,
        setRecovery: (a) => { recovery = a; },
      };
      await phases.onError.run(errCtx, { signal: new AbortController().signal, trace: ctx.trace });
      return { output: state.output, status: 'aborted' };
    }
    // ... 其他错误处理
  }

  return { output: state.output, status: 'success' };
}
```

---

## 4. Controls

```typescript
// src/core/controls.ts

/**
 * AgentControls — 独立于 Loop 和 Phase 的控制原语。
 *
 * 设计原则：
 * - 硬中断通过 AbortController 传播（系统级，不依赖 Loop 轮询）
 * - 软中断（pause/steer/followUp）通过队列或 Promise 实现
 * - retry/recovery 通过 onError Phase 的 Hook 决策
 */
interface AgentControls {
  // ── 硬中断 —— AbortController 层次化传播 ──

  /** 根 AbortController。所有子操作合并此 signal */
  readonly abortController: AbortController;

  /** 触发硬中断。等效于 abortController.abort(reason) */
  abort(reason?: string): void;

  /** 当前 abort 信号是否已被触发 */
  readonly aborted: boolean;

  // ── 软中断 —— 本轮执行完后停止 ──

  /** 请求本轮结束后暂停（保存 checkpoint） */
  pause(): void;

  /** 从 checkpoint 恢复执行 */
  resume(checkpoint?: Checkpoint): void;

  /** 等待恢复 */
  waitForResume(): Promise<void>;

  // ── 消息注入 ──

  /** 注入 Steering 消息：在当前轮中处理（下一次 LLM 调用前） */
  steer(message: Message | Message[]): void;

  /** 注入 Follow-up 消息：Agent 停止后触发新循环 */
  followUp(message: Message | Message[]): void;

  // ── 内部方法（Loop 使用） ──

  drainSteering(): Message[];
  drainFollowUp(): Message[];
}
```

---

## 5. TraceContext

```typescript
// src/core/trace.ts

/**
 * TraceContext — 嵌入内核的可观测性基座。
 *
 * 与当前 AgentForge 的区别：
 * - 当前: src/observability/trace-context.ts 是独立的查询接口
 * - v2:   src/core/trace.ts 是 AgentContext 的一等字段，Phase 内自动 Span
 */
interface TraceContext {
  /** 开启一个 Span */
  startSpan(name: string, options?: SpanOptions): Span;

  /** 获取当前活跃的 Span（Phase 内自动管理的） */
  currentSpan(): Span | undefined;

  /** 获取根 Span */
  rootSpan(): Span;

  /** 获取 session 内所有 Span */
  spans(): Iterable<Span>;

  /** 强制导出到 exporter */
  flush(): Promise<void>;
}

interface SpanOptions {
  attributes?: Record<string, unknown>;
  parentSpan?: Span;
}

interface Span {
  readonly id: string;
  readonly name: string;
  readonly startTime: number;
  readonly parentId?: string;

  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  recordException(error: Error): void;
  end(): void;
}
```

### Phase 内自动 Span

```typescript
// Phase.run() 内部自动 Span:
async run(ctx: TCtx, opts?: PhaseRunOptions): Promise<PhaseResult<TCtx>> {
  const trace = opts?.trace;
  const phaseSpan = trace?.startSpan(`phase.${this.name}`, {
    attributes: { hookCount: this.hooks.length },
  });

  try {
    let currentCtx = ctx;
    for (const hook of this._sortedHooks) {
      const hookSpan = trace?.startSpan(`hook.${hook.name}`, {
        parentSpan: phaseSpan,
        attributes: { priority: hook.priority },
      });

      try {
        const result = await hook.fn(currentCtx, opts?.signal);
        if (result === 'abort') {
          hookSpan?.setAttribute('result', 'abort');
          hookSpan?.end();
          return { ctx: currentCtx, aborted: true, abortReason: hook.name };
        }
        if (result !== undefined) {
          currentCtx = result;
        }
      } catch (err) {
        hookSpan?.recordException(err as Error);
        // 插件隔离——继续执行下一个 Hook
      } finally {
        hookSpan?.end();
      }
    }

    return { ctx: currentCtx, aborted: false };
  } finally {
    phaseSpan?.end();
  }
}
```

---

## 6. Plugin

```typescript
// src/plugins/plugin.ts

/**
 * v2 Plugin 接口。
 *
 * 当前（v1）vs v2:
 * - v1: 10 种分散的 Hook 数组（requestHooks[], toolHooks[], checkpointHooks[], ...）
 * - v2: 一个 hooks: AgentHook[] + eventSubscriptions[]
 *
 * 迁移兼容：v1 的旧字段保留一个版本，PluginManager 内部自动转换为新格式。
 */
interface Plugin {
  /** 唯一标识 */
  readonly name: string;

  /** 是否启用 */
  enabled?: boolean;

  /** 跨轮状态（框架不碰，插件自己管理） */
  state?: Record<string, unknown>;

  // ── v2: 统一 Hook 注册 ──

  /** 注册到 Phase Pipeline 的 Hook */
  hooks?: PhaseHookDeclaration[];

  /** 事件订阅（纯观察，不改动控制流） */
  events?: EventSubscription[];

  // ── 生命周期 ──
  init?(ctx: PluginContext): void | Promise<void>;
  destroy?(): void;
}

/**
 * PhaseHookDeclaration——声明一个 Hook 及其目标 Phase。
 *
 * Plugin 不需要知道 Phase Pipeline 的实现细节。
 * PhaseRegistry.registerPlugin() 自动分发到正确的 Phase。
 */
type PhaseHookDeclaration =
  | { phase: 'beforeLLM';  hook: Hook<BeforeLLMCtx> }
  | { phase: 'afterLLM';   hook: Hook<AfterLLMCtx> }
  | { phase: 'beforeTool'; hook: Hook<BeforeToolCtx> }
  | { phase: 'afterTool';  hook: Hook<AfterToolCtx> }
  | { phase: 'onError';    hook: Hook<ErrorCtx> }
  | { phase: 'onLLMChunk'; hook: ObserverHook<LLMChunkEvent> }
  | { phase: 'onCheckpoint'; hook: ObserverHook<CheckpointCtx> }
  | { phase: 'onCompact';   hook: ObserverHook<CompactCtx> }
  | { phase: 'onStateChange'; hook: ObserverHook<StateChangeCtx> };

/** 观察 Hook——只读，不修改 ctx，不 abort */
interface ObserverHook<T> {
  name: string;
  priority?: number;
  fn: (event: T) => void | Promise<void>;
}

/** 事件订阅——基于 AgentEventEmitter */
interface EventSubscription {
  event: AgentEventType;
  handler: (event: AgentEvent) => void | Promise<void>;
}
```

### 内置 Plugin 示例

```typescript
// src/plugins/memory-plugin.ts — v2 写法

function createMemoryPlugin(memoryStore: MemoryStore): Plugin {
  return {
    name: 'memory',
    hooks: [
      {
        phase: 'beforeLLM',
        hook: {
          name: 'memory-inject',
          priority: HookPriority.MEMORY,
          async fn(ctx) {
            const memories = await memoryStore.search(ctx.messages);
            if (memories.length > 0) {
              const injection = `[MEMORY]\n${memories.join('\n')}`;
              ctx.messages.unshift({ role: 'system', content: injection });
            }
            return ctx;
          },
        },
      },
      {
        phase: 'afterLLM',
        hook: {
          name: 'memory-update',
          priority: HookPriority.MEMORY,
          async fn(ctx) {
            await memoryStore.save(ctx.response);
          },
        },
      },
    ],
  };
}
```

---

## 7. BackendProtocol

```typescript
// src/backends/protocol.ts

/**
 * 文件系统抽象——借鉴 DeepAgents 的 BackendProtocol。
 *
 * 目的：
 * - StateBackend: 内存文件系统（测试、沙箱禁用时）
 * - FilesystemBackend: 真实磁盘（生产、CLI）
 * - SandboxBackend: Docker/E2B 沙箱
 *
 * AgentForge 当前没有这个抽象——工具直接操作 fs。
 * 引入后工具通过 Backend 操作文件，便于测试和沙箱切换。
 */
interface BackendProtocol {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  editFile(path: string, edits: Edit[]): Promise<void>;
  deleteFile(path: string): Promise<void>;

  ls(path: string): Promise<FileEntry[]>;
  glob(pattern: string): Promise<string[]>;
  grep(pattern: string, path: string): Promise<GrepMatch[]>;

  /** 执行 shell 命令（可选，取决于 backend 类型） */
  execute?(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
}

interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

interface Edit {
  oldText: string;
  newText: string;
}

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}
```

### Backend 实现

```typescript
// StateBackend: 内存实现，用于测试或禁止磁盘访问的场景
class StateBackend implements BackendProtocol {
  private files: Map<string, string> = new Map();
  // ...
}

// FilesystemBackend: 真实磁盘，生产 CLI 用
class FilesystemBackend implements BackendProtocol {
  // 带路径沙箱限制
  constructor(rootPath: string, allowedPaths: string[]) { ... }
  // ...
}
```

---

## 8. Agent 公共接口

```typescript
// src/api/agent.ts

/**
 * L2 Agent 接口——createAgent() 返回。
 */
interface Agent {
  // ── 运行 ──

  /** 同步执行，返回完整结果 */
  run(input: string, handlers?: RunHandlers): Promise<RunResult>;

  /** 流式迭代，yield 每个事件 */
  iterate(input: string): AsyncGenerator<AgentEvent, RunResult>;

  // ── 控制 ──

  /** 硬中断 */
  abort(reason?: string): void;

  /** 暂停（保存 checkpoint） */
  pause(): Promise<void>;

  /** 恢复（从 checkpoint） */
  resume(checkpoint?: Checkpoint): Promise<void>;

  /** 注入 steering 消息 */
  steer(message: Message): void;

  /** 注入 follow-up 消息 */
  followUp(message: Message): void;

  // ── 诊断 ──

  /** 配置溯源 + 运行时诊断 */
  diagnose(): AgentDiagnosis;

  // ── 事件 ──
  on<T extends AgentEvent['type']>(type: T, fn: Handler): () => void;
  onAny(fn: (e: AgentEvent) => void): () => void;

  // ── 生命周期 ──
  destroy(): void;
}

/**
 * L2 配置式 API（createAgent 接受的参数）。
 */
interface AgentConfig {
  model: { provider: string; model: string };
  tools?: ToolDefinition[];
  plugins?: Plugin[];
  permissions?: PermissionConfig;
  backend?: BackendProtocol;      // 新增：文件系统后端
  observability?: ObservabilityConfig;
  checkpoint?: CheckpointConfig;
  maxSteps?: number;
  systemPrompt?: string;
}

/**
 * L3 Builder API。
 */
class AgentBuilder {
  model(provider: string, model: string): this;
  withTools(tools: ToolDefinition[]): this;
  withPlugin(plugin: Plugin): this;
  withBackend(backend: BackendProtocol): this;
  withPermission(config: PermissionConfig): this;
  observe(config: ObservabilityConfig): this;
  build(): Promise<Agent>;
}

// 使用示例:
const agent = await AgentBuilder
  .model('anthropic', 'claude-sonnet-4-6')
  .withTools([bashTool, filesystemTool])
  .withPlugin(memoryPlugin())
  .withBackend(new FilesystemBackend('/workspace'))
  .observe({ exporters: ['langfuse'], sampleRate: 1.0 })
  .build();
```

---

## 9. 包结构

```
agentforge (monorepo)
├── packages/
│   ├── core/                      ← @agentforge/core
│   │   ├── src/
│   │   │   ├── loop/              # Agent Loop（双层）
│   │   │   ├── phase/             # Phase Pipeline + PhaseRegistry
│   │   │   ├── trace/             # TraceContext
│   │   │   ├── controls/          # AgentControls
│   │   │   ├── state/             # AgentState + StateMachine
│   │   │   ├── events/            # AgentEventEmitter + Zod schemas
│   │   │   ├── hooks/             # AgentHook 接口（向后兼容旧类型）
│   │   │   ├── plugin/            # Plugin 接口 + PluginManager
│   │   │   ├── backends/          # BackendProtocol + StateBackend + FilesystemBackend
│   │   │   ├── adapters/          # LLM 适配器（从 pi-ai 简化）
│   │   │   ├── diagnostics/       # diagnose() 实现
│   │   │   └── index.ts           # 公共 API
│   │   └── package.json
│   │
│   ├── security/                  ← @agentforge/security（可选）
│   │   ├── src/
│   │   │   ├── permissions/
│   │   │   ├── sandbox/
│   │   │   ├── audit/
│   │   │   ├── rate-limit/
│   │   │   └── sanitization/
│   │   └── package.json
│   │
│   ├── tools/                     ← @agentforge/tools（可选）
│   │   └── src/ (bash, filesystem, search, todo, etc.)
│   │
│   ├── memory/                    ← @agentforge/memory（可选）
│   │   └── src/ (compaction, working-memory, vector-stores)
│   │
│   ├── workflow/                  ← @agentforge/workflow（可选）
│   │   └── src/
│   │
│   ├── evaluation/                ← @agentforge/evaluation（可选）
│   │   └── src/
│   │
│   ├── a2a/                       ← @agentforge/a2a（可选）
│   │   └── src/
│   │
│   ├── mcp/                       ← @agentforge/mcp（可选）
│   │   └── src/
│   │
│   └── cli/                       ← @agentforge/cli（可选）
│       └── src/
│
└── agentforge/                    ← 全量安装的 meta 包（依赖所有子包）
    └── package.json
```

安装方式：

```bash
# 最小内核
npm i @agentforge/core

# 带安全层
npm i @agentforge/core @agentforge/security

# 全量
npm i agentforge
```

---

## 10. 迁移路径

### Phase 1: Phase Pipeline (不破坏现有 API)

**新增文件：**
- `src/core/phase/types.ts` — Hook, Phase, PhaseRegistry 类型
- `src/core/phase/pipeline.ts` — Phase 实现
- `src/core/phase/contexts.ts` — BeforeLLMCtx, AfterLLMCtx, etc.

**改动文件：**
- `src/loop/agent-loop.ts`:
  - Loop 内部改为调用 `phases.beforeLLM.run()` 而不是遍历 `hooks.getRequestHooks()`
  - 旧的调用方式保留 if-else 兼容（检查是否有 phases 对象）
- `src/core/context.ts`:
  - 新增 `trace: TraceContext` 字段
  - PhaseRegistry 可选的 fields
- `src/plugins/plugin.ts`:
  - 新增 `hooks?: PhaseHookDeclaration[]` 字段
  - 旧 10 个字段保留兼容

### Phase 2: TraceContext 嵌入

**新增文件：**
- `src/core/trace.ts` — TraceContext + Span 接口

**改动文件：**
- `src/core/phase/pipeline.ts` — Phase.run() 内部自动 Span

### Phase 3: Controls 独立

**新增文件：**
- `src/core/controls.ts` — AgentControls 实现

**改动文件：**
- `src/loop/agent-loop.ts` — 使用 controls 替代内联 abort/pause 逻辑

### Phase 4: 双层 Loop + BackendProtocol

**改动文件：**
- `src/loop/agent-loop.ts` — 改为双层循环（steeringQueue + followUpQueue）

**新增文件：**
- `src/backends/` — BackendProtocol + StateBackend + FilesystemBackend

### Phase 5: 包拆分 + 清理

- 拆分 monorepo 为多包
- 移除废弃的旧 Hook 类型
- 更新公共 API 导出

---

## 附录 A: 与当前代码的差异总结

| 当前 (v1) | v2 |
|-----------|-----|
| 单层 while(true) | 双层循环 (steering + followUp) |
| 10 种 Hook 类型分散注册 | Phase Pipeline (5 核心 + 4 观察) |
| HookRegistry 管理 Hook | PhaseRegistry 管理 Phase |
| Observability 独立模块 | TraceContext 嵌入 Phase |
| 无 Backend 抽象 | BackendProtocol 接口 |
| 单包 agentforge | 多包 @agentforge/* |
| 无 diagnose() | diagnose() 内置 |
| Plugin 接口: 10 个可选数组 | Plugin 接口: 1 个 hooks[] + events[] |
| Controls 散落在 Loop 方法上 | AgentControls 独立对象 |
