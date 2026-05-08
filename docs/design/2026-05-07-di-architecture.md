# AgentForge v2 — DI 架构

> 2026-05-07 | 从 DI 角度重新审视架构

## 一、当前问题诊断

当前 AgentForge 有三个 DI 反模式：

**反模式 1：AgentContext 是 Service Locator**

```typescript
// 当前——AgentContext 是一个巨大的"口袋"，所有人靠名字查找依赖
ctx.core.llm
ctx.security.permissionController
ctx.controls.hitl
ctx.memory.vectorStore
ctx.resilience.circuitBreaker
// ... 8 个子对象，30+ 个字段

// 问题：
// - AgentLoop 依赖 AgentContext 的全部，但实际只用了其中 5 个字段
// - Phase Pipeline 不知道 ctx 里有什么——只能靠运行时发现
// - 测试需要构造整个 AgentContext，即使只测一个 Hook
// - 依赖关系隐藏在闭包中，不可静态分析
```

**反模式 2：Phase.run() 内部"发现" TraceContext**

```typescript
// 当前设计——Phase.run() 内部根据 opts?.trace 决定是否创建 Span
async run(ctx, opts) {
  const span = opts?.trace?.startSpan(...);  // ← 隐式依赖
  // ...
}

// 问题：
// - Phase 依赖 TraceContext 的具体实现，但通过可选参数"偷偷"传入
// - 如果 opts.trace 为空，静默跳过——但 Phase 不知道发生什么
// - 测试需要 mock opts.trace，而不是注入一个 NoopTracer
```

**反模式 3：PluginContext 按需注入能力**

```typescript
// 当前——PluginContext 有 10+ 个可选字段
interface PluginContext {
  executeTool?(): Promise<string>;   // 有就有，没有就 undefined
  getLLM?(): LLMAdapter;             // 插件通过 ?. 调用
  registerTool?(tool): void;
  // Plugin 不知道哪些能力可用，运行时才发现
}

// 问题：
// - 插件无法在初始化时验证依赖是否满足
// - 接口不表达契约——"我需要 executeTool，否则无法工作"
// - requiredCapabilities 字符串数组是补救措施，但它是外挂的
```

## 二、DI 原则

```
1. 依赖接口，不依赖实现
   Phase → Tracer (interface)，不是 Phase → OTelTracer (concrete)

2. 显式注入，不隐式发现
   new Phase(hooks, tracer, signal) ← 构造函数注入
   不是 phase.run(ctx, { trace: maybeTracer }) ← 可选参数

3. 组合根统一装配
   createAgent() 是唯一的 new 聚集地
   Phase/Backend/LLM 都不应该自己 new 依赖

4. 最少知识
   Phase 只知道 Tracer 接口（startSpan/endSpan）
   不知道 OTel、Langfuse、Span 树

5. 契约优先
   Plugin 声明"我需要什么" → 编译时/初始化时验证
   不是运行时 ?. 调用
```

## 三、依赖分层

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 0: Contracts (零依赖，纯类型)                           │
│                                                              │
│ Tracer        — startSpan(name) → Span                       │
│ Backend       — readFile/writeFile/execute                   │
│ LLMProvider   — stream(messages, tools) → Response           │
│ Hook<T>       — apply(ctx) → T | 'abort'                    │
│ Phase<T>      — run(ctx) → { ctx, aborted }                 │
│ AgentLoop     — run(input) → RunResult                      │
│ Controls      — abort()/pause()/resume()/steer()/followUp()   │
└──────────────────────────────────────────────────────────────┘
                              ↑ 实现
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: Core (只依赖 Layer 0)                                │
│                                                              │
│ PhaseRegistry   — 管理 Phase 实例，接受 Hook[]               │
│ AgentLoopImpl   — 实现 AgentLoop，接受 PhaseRegistry + deps  │
│ ToolPipeline    — 工具执行链                                  │
│ StateMachine    — 状态机                                      │
│ AgentState      — 状态模型                                    │
│ AgentEventEmitter — 事件发射器                                │
└──────────────────────────────────────────────────────────────┘
                              ↑ 实现
┌──────────────────────────────────────────────────────────────┐
│ Layer 2: Hooks (只依赖 Layer 0 接口)                          │
│                                                              │
│ MemoryHook      — 依赖 Backend (read AGENTS.md)               │
│ WorkingMemHook  — 依赖内部状态                                │
│ SkillsHook      — 依赖 Backend (read skills/)                │
│ PermissionHook  — 依赖 PermissionPolicy (接口)                │
│ RateLimitHook   — 依赖 RateLimiter (接口)                     │
│ QualityGateHook — 依赖 LLMProvider (打分用)                   │
│ CompactionHook  — 依赖 CompactionStrategy (接口)              │
│ TracingHook     — 依赖 Tracer (只是另一个 Hook！)             │
└──────────────────────────────────────────────────────────────┘
                              ↑ 实现
┌──────────────────────────────────────────────────────────────┐
│ Layer 3: Adapters (实现 Layer 0 接口，依赖外部库)             │
│                                                              │
│ OTelTracer       — implements Tracer (OpenTelemetry)         │
│ LangfuseTracer   — implements Tracer (Langfuse)              │
│ NoopTracer       — implements Tracer (什么都不做)             │
│ FilesystemBackend — implements Backend                       │
│ StateBackend     — implements Backend (测试用)               │
│ SandboxBackend   — implements Backend (Docker/E2B)           │
│ OpenAIAdapter    — implements LLMProvider                    │
│ AnthropicAdapter — implements LLMProvider                    │
│ InMemoryStore    — implements MemoryStore                    │
│ PostgresStore    — implements MemoryStore                    │
└──────────────────────────────────────────────────────────────┘
                              ↑ 装配
┌──────────────────────────────────────────────────────────────┐
│ Layer 4: Composition Root                                    │
│                                                              │
│ createAgent(config) — 唯一的 new 聚集地                       │
│ AgentBuilder       — 流畅 API，底层调 createAgent            │
│                                                              │
│ 根据 config 选择 Adapter 实现，构造 Hook，装配 Phase，       │
│ 创建 AgentLoop，返回 Agent 接口                              │
└──────────────────────────────────────────────────────────────┘
```

## 四、接口定义 (Layer 0)

```typescript
// ── src/contracts/tracer.ts ──

interface Tracer {
  /** 开启 Span，返回 Span 句柄 */
  startSpan(name: string, options?: SpanOptions): Span;
}

interface Span {
  readonly id: string;
  setAttribute(key: string, value: unknown): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
  recordException(error: Error): void;
  end(): void;
}

interface SpanOptions {
  attributes?: Record<string, unknown>;
  parent?: Span;  // 通过引用建立父子关系，不是通过"当前 span 栈"
}
```

```typescript
// ── src/contracts/backend.ts ──

interface Backend {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  ls(path: string): Promise<FileEntry[]>;
  glob(pattern: string): Promise<string[]>;
  grep(pattern: string, path: string): Promise<GrepMatch[]>;
}

// Shell 能力是可选的——不是所有 Backend 都支持
interface ShellBackend extends Backend {
  execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
}
```

```typescript
// ── src/contracts/llm.ts ──

interface LLMProvider {
  /** 流式调用 */
  stream(request: LLMRequest): Promise<LLMStreamResponse>;
}

interface LLMRequest {
  messages: Message[];
  tools: ToolDefinition[];
  systemPrompt: string;
  model: string;
  options?: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  };
}

interface LLMStreamResponse {
  /** 异步迭代 chunk */
  [Symbol.asyncIterator](): AsyncIterator<LLMChunk>;
  /** 获取最终聚合结果（所有 chunk 结束后） */
  result(): Promise<LLMFinalResult>;
}
```

```typescript
// ── src/contracts/phase.ts ──

/**
 * Phase 需要的依赖——通过构造函数注入，不是可选参数。
 */
interface PhaseDeps {
  signal: AbortSignal;
  tracer: Tracer;  // ← 显式依赖，不是可选。不想用就注入 NoopTracer
}

interface Phase<T> {
  readonly name: string;
  run(ctx: T, deps: PhaseDeps): Promise<PhaseResult<T>>;
}

interface PhaseResult<T> {
  ctx: T;
  aborted: boolean;
  abortReason?: string;
}
```

```typescript
// ── src/contracts/hook.ts ──

interface Hook<T> {
  name: string;
  priority: number;
  apply(ctx: T, deps: HookDeps): Promise<T | 'abort'>;
}

/**
 * Hook 依赖——最小化。
 * 
 * Hook 不直接接触 Backend、LLMProvider 等全局资源。
 * 需要这些资源的 Hook 在构造时接收它们（构造函数注入）。
 */
interface HookDeps {
  signal: AbortSignal;
  tracer: Tracer;
}
```

```typescript
// ── src/contracts/agent.ts ──

interface Agent {
  run(input: string, handlers?: RunHandlers): Promise<RunResult>;
  iterate(input: string): AsyncGenerator<AgentEvent, RunResult>;

  // Controls
  abort(reason?: string): void;
  pause(): Promise<void>;
  resume(checkpoint?: Checkpoint): Promise<void>;
  steer(message: Message): void;
  followUp(message: Message): void;

  // Diagnostics
  diagnose(): AgentDiagnosis;

  // Events
  on<T extends AgentEvent['type']>(type: T, fn: Handler): () => void;
  destroy(): void;
}
```

## 五、Core 实现 (Layer 1)

```typescript
// ── src/core/phase-registry.ts ──

/**
 * PhaseRegistry——管理 Phase 实例。
 *
 * 仅依赖 Phase 接口和 Hook 接口，不依赖任何具体实现。
 */
class PhaseRegistry {
  constructor(
    private readonly hooks: HookDeclaration[]
  ) {
    // 根据声明创建 Phase 实例
    for (const decl of hooks) {
      this.getOrCreate(decl.phase).addHook(decl.hook);
    }
  }

  readonly beforeLLM: Phase<BeforeLLMCtx>;
  readonly afterLLM: Phase<AfterLLMCtx>;
  readonly beforeTool: Phase<BeforeToolCtx>;
  readonly afterTool: Phase<AfterToolCtx>;
  readonly onError: Phase<ErrorCtx>;

  /** 注册来自 Plugin 的 Hook 声明 */
  add(hooks: HookDeclaration[]): void;

  /** 获取指定 Phase 的所有 Hook（用于 diagnose()） */
  snapshot(): PhaseSnapshot[];
}

type HookDeclaration =
  | { phase: 'beforeLLM';  hook: Hook<BeforeLLMCtx> }
  | { phase: 'afterLLM';   hook: Hook<AfterLLMCtx> }
  | { phase: 'beforeTool'; hook: Hook<BeforeToolCtx> }
  | { phase: 'afterTool';  hook: Hook<AfterToolCtx> }
  | { phase: 'onError';    hook: Hook<ErrorCtx> };
```

```typescript
// ── src/core/agent-loop-impl.ts ──

/**
 * AgentLoopImpl——实现 AgentLoop 接口。
 *
 * 依赖通过构造函数注入：
 * - phases: PhaseRegistry（Phase 集合）
 * - llm: LLMProvider（LLM 调用）
 * - backend: Backend（文件操作）
 * - tracer: Tracer（可观测性）
 * - tools: ToolRegistry（工具执行）
 * - config: AgentConfig（模型、参数等）
 *
 * 不接受 AgentContext——每个依赖显式声明。
 * 组合根负责将 AgentConfig 转化为这些显式依赖。
 */
class AgentLoopImpl implements AgentLoop {
  constructor(
    private readonly phases: PhaseRegistry,
    private readonly llm: LLMProvider,
    private readonly backend: Backend,
    private readonly tracer: Tracer,
    private readonly tools: ToolRegistry,
    private readonly controls: AgentControls,
    private readonly config: AgentLoopConfig,
  ) {}

  async run(input: string): Promise<RunResult> {
    const ac = this.controls.abortController;
    const signal = ac.signal;
    let state = createInitialState(input, this.config);

    try {
      outer: while (!signal.aborted) {
        let hasToolCalls = true;

        while (hasToolCalls && !signal.aborted) {
          signal.throwIfAborted();

          // Phase: beforeLLM
          const beforeResult = await this.phases.beforeLLM.run(
            { messages: state.messages, tools: state.tools, systemPrompt: this.config.systemPrompt, state },
            { signal, tracer: this.tracer }
          );
          if (beforeResult.aborted) break outer;
          state.messages = beforeResult.ctx.messages;

          // LLM
          const response = await this.llm.stream({
            messages: beforeResult.ctx.messages,
            tools: beforeResult.ctx.tools,
            systemPrompt: beforeResult.ctx.systemPrompt,
            model: this.config.model.model,
            options: { signal, temperature: this.config.temperature },
          });

          // After LLM
          await this.phases.afterLLM.run(
            { messages: state.messages, response: await response.result(), state },
            { signal, tracer: this.tracer }
          );

          // Tools
          if (!response.toolCalls?.length) { hasToolCalls = false; break; }

          for (const tc of response.toolCalls) {
            const tcResult = await this.phases.beforeTool.run(
              { toolCall: tc, messages: state.messages, state, modifyArgs: (a) => { tc.args = a; } },
              { signal, tracer: this.tracer }
            );
            if (tcResult.aborted) continue;

            const result = await this.tools.execute(tcResult.ctx.toolCall, { signal, backend: this.backend });
            await this.phases.afterTool.run(
              { toolCall: tc, result, state, replaceResult: (r) => { result = r; } },
              { signal, tracer: this.tracer }
            );
            state.messages.push(createToolResultMessage(result));
          }
          state.step++;
        }

        const followUps = this.controls.drainFollowUp();
        if (!followUps.length) break outer;
        state.messages.push(...followUps);
      }
    } catch (e) {
      if (isAbortError(e)) {
        await this.phases.onError.run(
          { error: serializeError(e), phase: 'llm', attempt: 0, state, setRecovery: () => {} },
          { signal: new AbortController().signal, tracer: this.tracer }
        );
        return { output: state.output, status: 'aborted' };
      }
      // ... 其他错误处理
    }

    return { output: state.output, status: 'success' };
  }
}
```

## 六、Hook 实现 (Layer 2)

```typescript
// ── 每个 Hook 通过构造函数接收它需要的依赖 ──

/**
 * MemoryHook——注入 AGENTS.md 记忆到 LLM 上下文。
 *
 * 依赖 Backend 接口（用于读取 AGENTS.md 文件）。
 * 不依赖任何具体实现。
 */
class MemoryHook implements Hook<BeforeLLMCtx> {
  name = 'memory';
  priority = HookPriority.MEMORY;

  constructor(
    private readonly backend: Backend,  // ← 显式注入
    private readonly memoryFilePath: string = 'AGENTS.md',
  ) {}

  async apply(ctx: BeforeLLMCtx, deps: HookDeps): Promise<BeforeLLMCtx | 'abort'> {
    deps.signal.throwIfAborted();

    const span = deps.tracer.startSpan('hook.memory.inject');
    try {
      const content = await this.backend.readFile(this.memoryFilePath);
      ctx.messages.unshift({ role: 'system', content });
      span.setAttribute('memory.size', content.length);
      return ctx;
    } catch {
      // AGENTS.md 不存在——不是错误
      return ctx;
    } finally {
      span.end();
    }
  }
}

/**
 * PermissionHook——工具执行前检查权限。
 *
 * 依赖 PermissionPolicy 接口，不依赖具体实现。
 */
class PermissionHook implements Hook<BeforeToolCtx> {
  name = 'permission';
  priority = HookPriority.PERMISSION;

  constructor(private readonly policy: PermissionPolicy) {}

  async apply(ctx: BeforeToolCtx, deps: HookDeps): Promise<BeforeToolCtx | 'abort'> {
    const span = deps.tracer.startSpan('hook.permission.check');
    try {
      const allowed = await this.policy.check(ctx.toolCall);
      if (!allowed) {
        span.setAttribute('result', 'blocked');
        return 'abort';
      }
      span.setAttribute('result', 'allowed');
      return ctx;
    } finally {
      span.end();
    }
  }
}

/**
 * TracingHook——Tracer 自己也是一个 Hook（不是特殊的内核机制）。
 *
 * 它的工作是在 Phase 边界自动创建 Span。
 * 但因为 Phase.run() 本身已经接受 tracer 并自动创建 Span，
 * 这个 Hook 可以用于 Phase 内部无法覆盖的细粒度追踪。
 */
class TracingHook implements Hook<AfterLLMCtx> {
  name = 'tracing';
  priority = 0;  // 最先执行

  constructor(private readonly tracer: Tracer) {}

  async apply(ctx: AfterLLMCtx, deps: HookDeps): Promise<AfterLLMCtx> {
    const span = deps.tracer.startSpan('agent.llm.record', {
      attributes: {
        'tokens.input': ctx.response.usage.input,
        'tokens.output': ctx.response.usage.output,
        'cost.total': ctx.response.cost.total,
        'finishReason': ctx.response.finishReason,
      },
    });
    span.end();
    return ctx;
  }
}
```

## 七、Adapter 实现 (Layer 3)

```typescript
// ── src/adapters/otel-tracer.ts ──

/**
 * OTelTracer——将 AgentForge 的 Tracer 接口适配到 OpenTelemetry SDK。
 *
 * 依赖 @opentelemetry/api 和 @opentelemetry/sdk-trace-node。
 * 这是外部依赖的"隔离带"——其他层不知道 OTel 的存在。
 */
class OTelTracer implements Tracer {
  constructor(
    private readonly otelTracer: OTelTracer,
    private readonly exporter: SpanExporter,
  ) {}

  startSpan(name: string, options?: SpanOptions): Span {
    const otelSpan = this.otelTracer.startSpan(name, {
      attributes: options?.attributes,
    });
    return new OTelSpan(otelSpan);
  }
}

class OTelSpan implements Span {
  constructor(private readonly otel: OTelSpan) {}
  get id(): string { return this.otel.spanContext().spanId; }
  setAttribute(key: string, value: unknown): void { this.otel.setAttribute(key, value as OTelValue); }
  addEvent(name: string, attrs?: Record<string, unknown>): void { this.otel.addEvent(name, attrs); }
  recordException(error: Error): void { this.otel.recordException(error); }
  end(): void { this.otel.end(); }
}

// ── src/adapters/noop-tracer.ts ──

/**
 * NoopTracer——什么都不做。
 *
 * 用于测试、或用户关闭可观测性时。
 * 这是 Tracer 接口的自然消费者——不需要特殊处理。
 */
class NoopTracer implements Tracer {
  startSpan(_name: string, _options?: SpanOptions): Span {
    return NOOP_SPAN;
  }
}

const NOOP_SPAN: Span = {
  id: '',
  setAttribute() {},
  addEvent() {},
  recordException() {},
  end() {},
};
```

## 八、组合根 (Layer 4)

```typescript
// ── src/api/create-agent.ts ──

/**
 * createAgent——唯一的装配点。
 *
 * 这里 new 所有具体实现，然后传递给构造函数。
 * 不在其他地方出现 new。
 */
async function createAgent(config: AgentConfig): Promise<Agent> {
  // 1. 解析 Adapter 实现
  const llm = resolveLLMProvider(config.model);
  const backend = resolveBackend(config.backend);
  const tracer = resolveTracer(config.observability);

  // 2. 构造 Hook 实例——每个 Hook 接收它需要的依赖
  const hooks: HookDeclaration[] = [];

  if (config.memory?.enabled) {
    hooks.push({
      phase: 'beforeLLM',
      hook: new MemoryHook(backend, config.memory.filePath),
    });
  }

  if (config.skills?.enabled) {
    hooks.push({
      phase: 'beforeLLM',
      hook: new SkillsHook(backend, config.skills.path),
    });
  }

  if (config.permissions?.enabled) {
    hooks.push({
      phase: 'beforeTool',
      hook: new PermissionHook(config.permissions.policy),
    });
  }

  if (config.rateLimit?.enabled) {
    hooks.push({
      phase: 'beforeLLM',
      hook: new RateLimitHook(config.rateLimit.limiter),
    });
  }

  if (config.qualityGate?.enabled) {
    hooks.push({
      phase: 'afterLLM',
      hook: new QualityGateHook(llm, config.qualityGate),
    });
  }

  // 3. 用户自定义 Plugin
  for (const plugin of config.plugins ?? []) {
    hooks.push(...plugin.hooks);
  }

  // 4. 装配
  const phases = new PhaseRegistry(hooks);
  const tools = new ToolRegistry(config.tools, backend);
  const controls = new AgentControlsImpl();

  const loop = new AgentLoopImpl(phases, llm, backend, tracer, tools, controls, {
    model: config.model,
    maxSteps: config.maxSteps ?? 10,
    systemPrompt: config.systemPrompt ?? '',
    temperature: config.temperature,
  });

  return new AgentImpl(loop, controls, tracer, phases);
}
```

```typescript
// ── src/api/agent-builder.ts ──

/**
 * AgentBuilder——流畅 API，底层调 createAgent。
 *
 * 是 L2 配置和 L3 程序化之间的桥梁。
 */
class AgentBuilder {
  private _model: ModelSpec | null = null;
  private _tools: ToolDefinition[] = [];
  private _plugins: Plugin[] = [];
  private _backend: Backend | null = null;
  private _permissions: PermissionConfig | null = null;
  private _observability: ObservabilityConfig = { enabled: false };
  private _memory: MemoryConfig | null = null;
  private _skills: SkillsConfig | null = null;

  model(provider: string, model: string): this { ... }
  withTools(tools: ToolDefinition[]): this { ... }
  withPlugin(plugin: Plugin): this { ... }
  withBackend(backend: Backend): this { ... }
  withPermission(config: PermissionConfig): this { ... }
  observe(config: ObservabilityConfig): this { ... }
  withMemory(config: MemoryConfig): this { ... }
  withSkills(config: SkillsConfig): this { ... }

  async build(): Promise<Agent> {
    return createAgent({ /* 聚合所有配置 */ });
  }
}
```

## 九、Plugin 的 DI 模型

```typescript
/**
 * Plugin——扩展的声明式接口。
 *
 * Plugin 不接收 PluginContext（Service Locator）。
 * Plugin 声明它需要什么依赖，组合根负责注入。
 *
 * 灵感来源：pi-mono 的 ExtensionFactory——Plugin 是一个函数，
 * 接收它需要的依赖，返回 Hook 声明。
 */
interface Plugin {
  readonly name: string;

  /**
   * 声明 Hook 和它们需要的依赖。
   *
   * @param deps - Plugin 需要的依赖（由组合根注入）
   * @returns Hook 声明数组
   */
  register(deps: PluginDeps): HookDeclaration[];
}

/**
 * PluginDeps——插件可用的依赖。
 *
 * 这不是 Service Locator——这是组合根传递给插件的"我能提供什么"。
 * 插件通过参数解构选择它需要的：
 *
 *   register({ backend, tracer }) { ... }  // 只需这两个
 *   register({ llm }) { ... }              // 只需 LLM
 */
interface PluginDeps {
  backend: Backend;
  tracer: Tracer;
  llm: LLMProvider;
  tools: ToolRegistry;
  config: Readonly<AgentConfig>;
}
```

### 内置 Plugin 示例

```typescript
// ── src/plugins/memory-plugin.ts ──

function memoryPlugin(options?: { filePath?: string }): Plugin {
  return {
    name: 'memory',
    register({ backend, tracer }) {  // ← 只解构需要的
      const hook = new MemoryHook(backend, options?.filePath ?? 'AGENTS.md');
      return [{ phase: 'beforeLLM', hook }];
    },
  };
}

// ── src/plugins/permission-plugin.ts ──

function permissionPlugin(policy: PermissionPolicy): Plugin {
  return {
    name: 'permission',
    register({}) {  // ← PermissionHook 在构造时已接收 policy
      const hook = new PermissionHook(policy);
      return [{ phase: 'beforeTool', hook }];
    },
  };
}
```

## 十、与之前设计的对照

| | Phase Pipeline Spec | DI 修正 |
|---|---|---|
| Phase.run() 的 tracer 来源 | 可选参数 `opts?.trace` | 构造函数注入 `PhaseDeps.tracer` |
| Hook 的依赖获取 | 通过 HookFn 闭包 | 构造函数注入具体接口 |
| TraceContext 位置 | `src/core/trace.ts` | `src/contracts/tracer.ts` (接口) + `src/adapters/otel-tracer.ts` (实现) |
| Backend 位置 | `src/backends/protocol.ts` | `src/contracts/backend.ts` (接口) + `src/adapters/*-backend.ts` (实现) |
| Plugin 注册方式 | `hooks?: PhaseHookDeclaration[]` | `register(deps: PluginDeps): HookDeclaration[]` |
| AgentLoop 依赖 | 通过 AgentContext 隐式传入 | 构造函数显式注入 |
| 组合根 | 分散在 `createAgent()` 中 | 集中在 `createAgent()`，但每层依赖显式 |
| 测试友好性 | 需要 mock AgentContext | 直接注入 mock 接口 |

## 十一、测试友好性

```typescript
// ── 测试 Phase 独立行为 ──
test('beforeLLM phase runs hooks in priority order', async () => {
  const phase = new PhaseImpl<BeforeLLMCtx>('beforeLLM', [
    { name: 'first', priority: 10, fn: async (ctx) => { ctx.messages.push('first'); return ctx; } },
    { name: 'second', priority: 20, fn: async (ctx) => { ctx.messages.push('second'); return ctx; } },
  ]);

  const result = await phase.run(
    { messages: [], tools: [], systemPrompt: '', state: mockState },
    { signal: new AbortController().signal, tracer: new NoopTracer() }
  );

  expect(result.ctx.messages).toEqual(['first', 'second']);
});

// ── 测试 MemoryHook 独立行为 ──
test('memory hook injects AGENTS.md content', async () => {
  const backend = new StateBackend({ 'AGENTS.md': 'Project rules here' });
  const hook = new MemoryHook(backend);

  const ctx = { messages: [], tools: [], systemPrompt: '', state: mockState };
  const result = await hook.apply(ctx, {
    signal: new AbortController().signal,
    tracer: new NoopTracer(),
  });

  expect(result.messages[0].content).toContain('Project rules here');
});

// ── 测试 AgentLoop 集成行为 ──
test('agent loop stops when beforeLLM hook aborts', async () => {
  const abortingHook: Hook<BeforeLLMCtx> = {
    name: 'abort-early',
    priority: 10,
    async apply() { return 'abort'; },
  };

  const phases = new PhaseRegistry([
    { phase: 'beforeLLM', hook: abortingHook },
  ]);

  const loop = new AgentLoopImpl(
    phases,
    mockLLM,           // 不应被调用
    new StateBackend(),
    new NoopTracer(),
    mockTools,
    new AgentControlsImpl(),
    defaultConfig,
  );

  const result = await loop.run('test input');
  expect(result.status).toBe('aborted');
});
```

## 十二、关键决策总结

| 决策 | 理由 |
|------|------|
| Tracer / Backend / LLMProvider 全是接口 | 测试不需要 OTel SDK、不需要真实磁盘、不需要 API key |
| NoopTracer 是 Tracer 接口的合法实现 | 关闭可观测性不需要 if/else——注入 NoopTracer 即可 |
| Phase.run() 显式接收 Tracer | Phase 应该知道自己被观测，这不应是可选的 |
| Hook 通过构造函数接收依赖 | Plugin.register() 是组合根的一部分——在此时注入 |
| AgentLoopImpl 不接收 AgentContext | 每个依赖显式列出，一眼看清它依赖什么 |
| Plugin 不接收 PluginContext | PluginDeps 是组合根提供的最小契约 |
