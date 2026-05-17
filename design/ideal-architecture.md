# AgentForge 理想架构设计规范

> 本文档是架构审计 + 第一性原理推导的结论，用于指导详细设计和实施。

## 四个目标（不可妥协）

```
① 全链路透明可观测  — 看不到就无法调试、审计、信任
② 全链路切面可插拔  — 每个行为可替换，不需改源码
③ 符合 harness 工程 — 框架管控生命周期，不是 agent 自管
④ 全链路高安全可审计 — 人在环路，可中断，可恢复，可重试
```

所有设计决策从这四条推导。不引用"别人怎么做"。

### 验收标准

每个目标必须可量化验证。以下条件全部满足才算"完成"。

| 目标 | 验收条件 | 验证方式 |
|------|---------|---------|
| ① 全链路可观测 | 1. 每个 pipeline stage 产生 `stage:before` + `stage:after` 事件<br>2. 每个 LLM 调用产生 `llm:before` + `llm:after` + span<br>3. 每次工具执行产生 `tool:before` + `tool:after` 事件<br>4. Agent 级事件 (`agent:start`, `agent:end`, `iteration:end`, `error`) 全部发射<br>5. 事件覆盖率测试通过 (见测试规范) | 自动化测试：注册 subscriber 计数，运行一次完整 agent，断言每个事件类型 ≥1 次 |
| ② 全链路可插拔 | 1. 每个 stage 的 Processor 可被 `replace()` 替换，替换后行为改变<br>2. Processor 可被 `unregister()` 移除，移除后 stage 变为 no-op<br>3. 插件通过单一 API (`registerHook`) 注册 hook，不需要知道内部引擎 | 集成测试：replace invokeLLM 为 mock，断言 LLM 未被调用 |
| ③ Harness 工程 | 1. Agent 构造函数接受所有核心依赖注入<br>2. 无模块级可变全局状态<br>3. Agent 状态转移只通过合法路径，非法转移抛异常<br>4. `setup()` / `run()` / `teardown()` 生命周期完整 | 单元测试：注入 mock deps，断言 Agent 使用注入的实例；状态机转移测试 |
| ④ 安全可审计 | 1. 每个 permission decision 产生可查询的审计记录<br>2. SUSPEND 时 checkpoint 可完整序列化 + 反序列化<br>3. RESUME 后从断点继续，不丢失已完成进度<br>4. 任意 stage 间可中断 (双重 AbortSignal 检查) | 集成测试：suspend → resume → 断言 context 完整；checkpoint round-trip 测试 |

---

## 一、核心抽象：两种机制覆盖四个目标

```
Hook (观察层):   before/after, (data) => void, 就地变异, 保证执行
Processor (行为层): execute(ctx) => ctx | AbortSignal | SuspensionSignal, 可替换/可门控
```

**没有第三种抽象。** 不存在 wrap hook、checkpoint hook、middleware 等独立机制。
需要观察 → Hook。需要行为/控制 → Processor。

### 变异边界

Hook handler 接收 `input` 和 `output` 两个参数，就地变异 `input` 中的可写字段。
但**不是所有字段都允许变异**。

```typescript
// Hook 变异边界 — 在类型层面区分可变与不可变区域
interface StageHookInput {
  stage: PipelineStage;        // readonly — 不允许改变当前 stage
  context: {
    request: DeepReadonly<PipelineContext['request']>;  // 不可变 — 输入是事实
    agent: Mutable<PipelineContext['agent'],            // 可变 — config 可被 hook 修改
      'promptFragments' | 'toolDeclarations'>;
    iteration: Mutable<PipelineContext['iteration'],    // 可变 — step 状态可被 hook 修改
      'step' | 'loopDirective'>;
    session: PipelineContext['session'];                // 可变 — messageHistory 可追加
  };
}
```

**推导来源：** 目标①② — 变异边界显式化防止 hook 意外修改不可变数据（如 request.input），同时允许合法的预处理（如注入额外 promptFragment）。

> **实施提示：** `DeepReadonly` 和 `Mutable` 工具类型定义在 `packages/sdk/src/types.ts`。Stage 外壳在调用 hook 前构造 `StageHookInput`，确保类型约束在编译期生效。

---

## 二、Stage 统一外壳

每个 Stage 由外壳自动编织三项结构职责，Processor 只写纯业务逻辑。

### 执行顺序

```
Stage 执行顺序:
  ① 自动: parentSpan.createChildSpan(stageName)
  ② Hook: before hooks — handler(ctx) => void, 就地变异
  ③ 自动: bridge -> EventBus.emit(stageName + '.before', snapshot)
  ④ Processor.execute(ctx) — 纯业务逻辑 + 自己 setAttribute 语义数据
  ⑤ Hook: after hooks — handler(ctx) => void, 就地变异
  ⑥ 自动: bridge -> EventBus.emit(stageName + '.after', snapshot)
  ⑦ 自动: span.end() 记录 duration
```

### EventBus 时序语义

**关键定义：EventBus 消费者看到的是 post-hook 状态，不是 pre-hook 状态。**

步骤 ③ 发射的 `.before` snapshot 在 hooks 执行之后。如果需要 pre-hook 状态，hook handler 自行在内部记录。

```
时间线:
  [原始 ctx] → before hooks 变异 → [变异后 ctx] → bridge emit .before(snapshot) → Processor.execute
                                                        ↑
                                            EventBus 消费者在此处看到变异后的 ctx
```

这样设计的理由：EventBus 消费者（日志、监控、审计）关心的是"实际传给 Processor 的输入"，而不是"hook 变异前的原始输入"。如果 hook 注入了一个额外的 promptFragment，审计系统应该看到这个 fragment。

### 职责矩阵

| 职责 | 负责者 | 原因 |
|------|-------|------|
| span 创建 + duration | Stage 外壳 (自动) | 结构信息，Stage 知道 |
| span 语义 attribute | Processor (手动) | 语义数据，只有 Processor 知道 |
| event 发射 | Stage 外壳 (自动 bridge) | 不可绕过 |
| before/after hook 调用 | Stage 外壳 (自动) | 保证执行 |
| 业务逻辑 | Processor | 开发者写 |

**推导来源：**
- 自动 span + event -> 目标① (状态变迁必须产生信号，不可绕过)
- Processor setAttribute -> 目标① (语义数据只有 Processor 知道)
- Hook 自动调用 -> 目标② (保证注册即执行)

---

## 三、Hook 系统

### 3.1 签名

```typescript
type HookHandler<T> = (data: T) => void | Promise<void>;
```

**就地变异，无返回值。** 不引入返回值 merge 复杂度。

### 3.2 只有 before/after，没有 wrap

- before: stage 执行前，可修改 input，但 execute 必定执行
- after: stage 执行后，可修改 output，但 execute 已经执行完
- wrap: **不存在。** 控制流变更属于 Processor replace

**跳过语义 (Skip)：** 如果需要在运行时根据条件跳过某个 stage 的业务逻辑，有两种方式：

| 方式 | 适用场景 | 示例 |
|------|---------|------|
| **Processor 内部 if** | 跳过逻辑与业务逻辑强耦合 | invokeLLM Processor 检测到缓存命中 → 直接返回 ctx，不调用 LLM |
| **replace Processor** | 跳过逻辑是外部策略（测试 mock、插件覆盖） | 测试时将 invokeLLM 替换为返回固定响应的 Processor |

不需要 `SkipSignal` — "跳过"本质是 "Processor 不做有意义的工作，直接返回 ctx"。这和 `AbortSignal`（终止管线）语义不同。

**为什么不用独立的 Skip 机制：**
1. Skip 是 Processor 内部决策，不是管线级信号 — 不需要跨 stage 传播
2. 如果 Skip 需要外部控制，用 `replace()` 替换整个 Processor 更干净
3. 引入 SkipSignal 会增加 ProcessorResult 的状态数（四态），增加认知负担

**推导来源：** 目标② — hook 永远不拥有控制流，注册即保证执行，可安全组合

### 3.3 两个引擎，一个入口

```
外部 API:
  api.registerHook({ point: 'tool.before', handler })  — 插件用，拦截
  api.subscribe('tool.before', listener)                — 消费者用，观察

内部实现:
  HookManager — 有序执行，handler 可变异 ctx，priority 排序
  EventBus    — 扇出广播，listener 接收 snapshot，只读

桥接:
  HookManager 所有 handler 执行完毕 -> 自动 bridge -> EventBus.emit
```

不合并 HookManager 和 EventBus — 它们的执行语义不同（有序变异 vs 扇出广播）。
统一的是入口，不是实现。

**推导来源：**
- 两个引擎 -> 目标①② (有序变异和扇出广播是不同语义，不能互相替代)
- 一个入口 -> 目标② (插件不应决定"用 hook 还是 event")

### 3.4 Handler 签名不携带控制流

```typescript
// 不要:
type HookHandler<T> = (data: T) => T | void;         // 返回值 merge 复杂
type HookHandler<T> = (data: T) => void | AbortSignal; // hook 不是 Processor

// 要:
type HookHandler<T> = (data: T) => void | Promise<void>; // 就地变异，简单
```

---

## 四、Processor 系统

### 4.1 ProcessorResult 三态

```typescript
type ProcessorResult =
  | PipelineContext       // 继续
  | AbortSignal           // 终止
  | SuspensionSignal;     // 暂停

interface AbortSignal {
  type: 'abort';
  reason: string;
  retryFrom?: PipelineStage;
}

interface SuspensionSignal {
  type: 'suspend';
  suspensionId: string;
  reason: string;
  checkpoint: PipelineCheckpoint;
}

interface PipelineCheckpoint {
  context: SerializablePipelineContext;
  nextStages: PipelineStage[];
  iteration: number;
}
```

**推导来源：** 目标④ — 管线需要"暂停"语义。一个 SuspensionSignal 解决 HITL/可恢复/可重试/审计。

### 序列化边界

`PipelineContext` 中包含不可序列化的字段（`fullStream`、`usagePromise`、`reasoningPromise`、`span`）。
checkpoint 序列化时必须处理这些字段。

```typescript
/** 可安全 JSON.stringify 的 PipelineContext 子集。 */
interface SerializablePipelineContext {
  request: RequestRegion;                        // 全部可序列化
  agent: Omit<AgentRegion, 'config'> & {         // config 中可能含函数 (Dynamic<T>)
    config: SerializedAgentConfig;
  };
  iteration: Omit<IterationRegion,
    'fullStream' |           // AsyncIterable — 不可序列化
    'usagePromise' |         // Promise — 不可序列化
    'reasoningPromise' |     // Promise — 不可序列化
    'span'                   // Span 对象 — 不可序列化
  >;
  session: Omit<SessionRegion, 'custom'> & {
    custom: Record<string, JsonValue>;           // custom 中的值必须是 JSON-safe
  };
}
```

**序列化规则：**
1. `iteration.fullStream` / `usagePromise` / `reasoningPromise` → 丢弃（resume 时由重新执行的 Processor 重新创建）
2. `iteration.span` → 丢弃（resume 时由新 Stage 外壳重新创建）
3. `agent.config` 中的 `Dynamic<T>` 函数 → 序列化为 `undefined` + 标记字段 `_wasDynamic: true`
4. `session.custom` → 深度 JSON 验证，非 JSON-safe 值抛异常

**反序列化规则（resume 时）：**
1. 重建 `PipelineContext`，不可序列化字段设为 `undefined`
2. `_wasDynamic` 标记的 config 字段恢复为上次解析的静态值（从最后一次 `processInput` 的输出中提取）
3. `nextStages[0]` 开始继续执行，跳过已完成的 stages

> **实施提示：** 在 `packages/sdk/src/` 中定义 `SerializablePipelineContext` 和 `serialize()`/`deserialize()` 函数。这两个函数是 checkpoint 的唯一入口，所有序列化/反序列化逻辑集中在此。

### 4.2 Processor 可 replace/remove

```typescript
class PipelineRunner {
  register(processor: Processor): void;
  unregister(stage: PipelineStage): void;          // 移除该 stage 的所有 processor
  replace(stage: PipelineStage, processor: Processor): void;  // 替换该 stage 的所有 processor
}
```

**推导来源：** 目标② — 完整替换需要全控制权

### 4.3 Stage 迁移映射

从当前 11-stage 到目标 10-stage 的对应关系：

```
当前 SDK PipelineStage (11):
  processInput, buildContext, prepareStep, invokeLLM, processStepOutput,
  executeTools, evaluateIteration, processOutput,
  beforeTool, execute, afterTool

目标管线 (10):
  processInput → buildContext
  → [Loop:
    prepareStep
    → gateLLM           ← 新增：quota / rate-limit
    → invokeLLM
    → processStepOutput
    → gateTool           ← 新增：permission / HITL
    → executeTools
    → evaluateIteration
  ]
  → processOutput
```

**迁移操作：**

| 操作 | 详情 |
|------|------|
| **新增** `gateLLM` | 插入在 `prepareStep` 和 `invokeLLM` 之间。SDK `PipelineStage` 类型增加 `'gateLLM'` |
| **新增** `gateTool` | 插入在 `processStepOutput` 和 `executeTools` 之间。SDK `PipelineStage` 类型增加 `'gateTool'` |
| **废弃** `beforeTool` | 被 `gateTool` 取代。`gateTool` 是管线级门控，`beforeTool` 是工具执行内部钩子，语义不同但职责重叠 |
| **废弃** `execute` | 从未被使用（没有 processor 注册在此 stage），直接删除 |
| **废弃** `afterTool` | 同 `beforeTool`，被 `gateTool` 的 after hook 覆盖 |
| **保留** 其余 8 stage | 不变，只是位置调整 |

> **实施提示：** 迁移分两步：(1) 先在 SDK 中新增 `gateLLM`/`gateTool` 类型值，旧值标记 `@deprecated`；(2) 一个版本后删除废弃值。这样给下游消费者留出迁移窗口。

### 4.4 门控 Stage

管线上增设两个门控 stage，用于注册安全/控制类 Processor：

门控 stage 上的 Processor 返回 AbortSignal（中止）或 SuspensionSignal（暂停），短路后续 Processor。

**门控 vs 普通 stage 的区别：**

| 维度 | 普通 stage | 门控 stage |
|------|-----------|-----------|
| 默认行为 | 继续执行 | 继续执行（无 Processor 时透明通过） |
| Processor 返回 AbortSignal | 终止管线 | 终止管线（同） |
| Processor 返回 SuspensionSignal | 暂停管线 | 暂停管线（同） |
| 多个 Processor | 全部顺序执行 | 第一个返回非-continue 短路后续 |
| 典型 Processor | 业务逻辑 | 策略控制（quota、permission、rate-limit） |

**推导来源：** 目标④ — 控制门是 Processor at gate stage，不是 hook + 新 API。不需要第三种抽象。

### 4.5 AbortSignal 双重检查

管线中存在两种 AbortSignal，都必须在 stage 间检查：

| 类型 | 来源 | 语义 | 检查点 |
|------|------|------|--------|
| **框架 AbortSignal** | Processor 返回的 `{ type: 'abort' }` | 业务级中止（配额耗尽、权限拒绝） | `PipelineRunner.executeStage()` 每个 stage 后 |
| **全局 AbortSignal** | 调用方传入的 `globalThis.AbortSignal` | 调用级取消（用户取消、超时） | `PipelineRunner.run()` 每个 stage 前 |

**当前问题：** 全局 AbortSignal 只在 Agent 循环顶部检查（`agent.ts:86,149`），不在 PipelineRunner 的 stage 间检查。长时间 LLM 调用期间无法取消。

**修复方案：**

```typescript
// PipelineRunner.run() 内部:
for (const stage of stages) {
  // 全局 signal 检查
  if (signal?.aborted) throw new DOMException('Pipeline aborted', 'AbortError');

  const stageResult = await this.executeStage(ctx, stage, stageSpan);

  // 框架 AbortSignal 检查
  if (this.isAbort(stageResult)) {
    stageSpan.end();
    rootSpan.end();
    return stageResult;
  }

  ctx = stageResult;
}
```

> **实施提示：** 需要将 `globalThis.AbortSignal` 从 `Agent.run()` 透传到 `PipelineRunner.run()`。当前 `PipelineRunner.run()` 不接受 signal 参数，需新增 `RunOptions` 参数。

---

## 五、SuspensionSignal 驱动目标④

### 5.1 HITL (人在环路)

```
gateTool stage -> hitlProcessor.execute(ctx)
  -> 检查是否需要人工审批
  -> 需要审批 -> 返回 SuspensionSignal
  -> Agent 暴露 suspensionId 给上层
  -> 上层调用 agent.resume(suspensionId, approval) 继续
```

HITL 不是 abort，是 suspend。管线暂停，保存完整状态，等待外部 resolve。

**推导来源：** 目标④-a — 每个危险动作执行前可被人工拦截审批

### 5.2 可恢复

```
suspend 时:
  SuspensionSignal.checkpoint 持久化到 SessionStorage

resume 时:
  从 checkpoint 恢复 PipelineContext
  + 从 checkpoint.nextStages 的第一个 stage 继续执行
  + 不丢失已完成的进度
```

**推导来源：** 目标④-c — 暂停后可从断点继续

### 5.3 可重试

```
checkpoint 记录了"在哪里失败"和"当时的完整状态"
  -> 重试 = 从 checkpoint 恢复 context + 重新执行失败 stage
  -> 可换参数重试 (修改 checkpoint.context 中的配置)
  -> 可从特定迭代重试 (修改 checkpoint.iteration)
```

**推导来源：** 目标④-d — 失败后可从失败点重试

### 5.4 审计追踪

每次 suspend/resume/retry/permission decision 通过 HookManager 自动 bridge 到 EventBus。消费者 subscribe 记录。

checkpoint 本身是最完整的审计记录：完整 context + 精确断点。

**推导来源：** 目标④-e — 每个决策有记录，不可篡改

### 5.5 超时与过期

Suspension 需要超时机制，防止无限期挂起。

```typescript
interface SuspensionSignal {
  type: 'suspend';
  suspensionId: string;
  reason: string;
  checkpoint: PipelineCheckpoint;
  expiresAt?: string;          // ISO 8601 时间戳，超时后自动 abort
  ttl?: number;                // 秒数，替代 expiresAt 的相对时间
}
```

**超时处理策略：**

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| 自动 abort | 超时后以 `AbortSignal` 终止管线 | 严格合规场景（金融、医疗） |
| 自动 continue | 超时后按默认决策继续执行 | 非关键审批（内容审核） |
| 无超时 | 永久等待直到 resume | 离线审批场景 |

默认策略由 `gateTool` Processor 的配置决定，不是框架级强制。

> **实施提示：** 超时检查由 `SessionManager` 的后台清理任务执行，不阻塞管线主循环。每分钟扫描一次状态为 `suspended` 且 `expiresAt < now` 的 session，触发配置的超时策略。

---

## 六、Harness 工程 (控制反转)

### 6.1 状态机

```typescript
type AgentStateEnum = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

// 合法转移:
// pending   -> [running]
// running   -> [paused, completed, cancelled, error]
// paused    -> [running, cancelled]
// completed -> [] (终态)
// cancelled -> [] (终态)
// error     -> [running]  // 可恢复错误允许重试
```

**error 状态可恢复条件：**

error 从终态改为可恢复终态是有条件的。不是所有 error 都可重试：

| 错误类型 | 可重试？ | 恢复方式 |
|---------|---------|---------|
| 网络超时 / 速率限制 | ✓ | 从 checkpoint 恢复 + 重试 |
| LLM API 临时错误 (5xx) | ✓ | 从 checkpoint 恢复 + 重试 |
| 配置错误 (401/403) | ✗ | 终态，需修复配置后创建新实例 |
| Processor 逻辑错误 | ✗ | 终态，需修复代码后创建新实例 |
| 用户取消 (AbortSignal) | ✗ | 应为 `cancelled`，不是 `error` |

**实现方式：**

```typescript
interface AgentError extends Error {
  recoverable: boolean;      // 是否可重试
  retryCount?: number;       // 已重试次数
  maxRetries?: number;       // 最大重试次数（默认 3）
}

// 状态转移守卫:
function canTransition(from: AgentStateEnum, to: AgentStateEnum, error?: AgentError): boolean {
  if (from === 'error' && to === 'running') {
    return error?.recoverable === true && (error?.retryCount ?? 0) < (error?.maxRetries ?? 3);
  }
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

**推导来源：** 目标③④ — 状态转移显式化，不可非法跳转；可恢复 error 与 retry 语义对齐

### 6.2 依赖注入

```typescript
interface AgentDependencies {
  runner?: PipelineRunner;
  registry?: ToolRegistry;
  pluginManager?: PluginManager;
  eventBus?: EventBus;
  hookManager?: HookManager;
  tracer?: Tracer;
  modelFactory?: ModelFactory;
  sessionFactory?: SessionManager;
}

class Agent {
  constructor(config: AgentConfig, deps?: AgentDependencies) { ... }
}
```

所有核心组件可注入。不传则内部创建（便利），传了则用注入的（可控）。

**注入规则：**

| 组件 | 不传时的默认行为 | 注入时的行为 |
|------|---------------|------------|
| `runner` | `new PipelineRunner({ tracer, hookManager })` | 使用注入的实例 |
| `registry` | `new ToolRegistry()` | 使用注入的实例 |
| `pluginManager` | `new PluginManager(runner, registry)` | 使用注入的实例 |
| `eventBus` | `pluginManager.eventBus` | 注入到 PluginManager 和 HookManager |
| `hookManager` | `pluginManager.hookManager` | 注入到 PipelineRunner |
| `tracer` | `new NoOpTracer()` | 注入到 PipelineRunner |
| `modelFactory` | 使用全局 `resolveModel()` | 使用注入的工厂 |
| `sessionManager` | `new SessionManagerImpl(...)` | 使用注入的实例 |

**关键：** 当注入 `hookManager` 时，必须确保 PipelineRunner 拿到它。当前代码中 PipelineRunner 没有收到 hookManager 是 P0 根因。

> **实施提示：** 构造函数逻辑：先解析 deps，缺失的内部创建，然后确保 PipelineRunner 持有 hookManager 引用。`eventBus` 和 `hookManager` 的注入是解开 P0 超级修复的关键。

### 6.3 生命周期

```typescript
interface Harness {
  setup(): Promise<void>;
  run(input: string): Promise<RunResult>;
  suspend(reason: string): Promise<void>;
  resume(suspensionId: string, payload?: unknown): Promise<RunResult>;
  teardown(): Promise<void>;
}
```

**生命周期保证：**

```
setup()              — 初始化资源、启动 plugin 资源、发射 agent:start
  run()              — 执行管线，可被 suspend 打断
  suspend()          — 暂停，保存 checkpoint
  resume()           — 从 checkpoint 恢复继续执行
teardown()           — 停止 plugin 资源、取消 event 订阅、发射 agent:end
```

**`teardown()` 必须做的事：**

1. 调用 `PluginManager.shutdown()` — 停止所有 plugin 注册的资源
2. 取消所有 EventBus 订阅 — 防止内存泄漏
3. 如果在 running 状态，先 cancel 再 teardown
4. 标记 Agent 为 `completed` 状态

> **当前问题：** Agent 没有 `teardown()` 方法，PluginManager 的资源永远不会被清理（`plugin-manager.ts:83-96` 的 `shutdown()` 从未被调用）。

### 6.4 无全局单例

```
消灭:
  - model-resolver.ts 的模块级 defaultChain       (model-resolver.ts:29)
  - builtin-gateway.ts 的模块级 customProviders    (builtin-gateway.ts:27)
  - builtin-gateway.ts 的模块级 sdkCache           (builtin-gateway.ts:28)

替代:
  - ModelFactory 类封装 GatewayChain + 缓存
  - 每个实例通过 deps.modelFactory 注入
  - ModelFactory 可注入到 Processor 中（invokeLLM 通过 ctx 间接获取）
```

**ModelFactory 接口：**

```typescript
interface ModelFactory {
  resolve(modelString: string): Promise<LanguageModel>;
  registerGateway(gateway: ModelGateway): void;
}
```

**推导来源：** 目标③ — 全局 = 不可隔离 = 不可测试

---

## 七、P0 超级修复

差距表中 5 个 P0 项有 3 个共享同一个根因：**Agent 构造函数没有将 HookManager 传给 PipelineRunner。**

```
P0-1: EventBus 10/12 事件从未发射      ─┐
P0-2: HookManager 11/12 hook 从未调用   ─┤ 共享根因
P0-3: PipelineRunner 不调用 hooks       ─┘
P0-4: LLMInvoker 忽略 tracer            ← 独立问题
P0-5: Agent 不持有 EventBus             ← 依赖 P0-1~3 修复后的架构调整
```

**一行修复解除 P0-1~3：**

```typescript
// 当前 (agent.ts:42):
this.runner = new PipelineRunner({ tracer: options?.tracer });

// 修复后:
this.runner = new PipelineRunner({
  tracer: options?.tracer,
  hookManager: this._pluginManager.hookManager,  // ← 这一行
});
```

但这要求 `_pluginManager` 在 `runner` 之前创建。当前代码中已经是这样（`agent.ts:44`），所以**不需要改变创建顺序**，只需要把 `hookManager` 传进去。

**修复后的效果：**

- `PipelineRunner.executeStage()` 中 `if (this.hookManager)` 不再总是 false
- 8 个活跃 stage 的 `stage.before` / `stage.after` hook 全部激活
- HookManager.bridge() 自动将 hook 调用转发到 EventBus
- 12 个事件中的 8 个 (`stage:before` × 4 + `stage:after` × 4) 立即可用
- 加上已有的 4 个 agent 级事件 (`agent:start`, `agent:end`, `iteration:end`, `error`)，12/12 事件全部发射

**验证方式：** 修复后运行 `pnpm test`，新增事件覆盖率测试应全部通过。

---

## 八、设计决策溯源总表

| # | 决策 | 目标 | 推导路径 |
|---|------|------|---------|
| 1 | Hook 只有 before/after | ② | 轻量观察，不控制流，可安全组合 |
| 2 | Hook 签名 `(data) => void` | ② | 就地变异，无返回值 merge |
| 3 | 无 wrap hook | ② | 控制流 = Processor 职责 |
| 4 | Skip 不需要独立信号 | ② | "跳过" = Processor 不做有意义工作，内部决策非管线级信号 |
| 5 | Processor 可 replace/remove | ② | 完整替换需要全控制权 |
| 6 | Stage 外壳自动 createSpan | ① | 状态变迁必须产生信号 |
| 7 | Processor 自己 setAttribute | ① | 语义数据只有 Processor 知道 |
| 8 | EventBus 消费者看到 post-hook 状态 | ① | 审计需要"实际传给 Processor 的输入" |
| 9 | HookManager + EventBus 两个引擎 | ①② | 有序变异 ≠ 扇出广播 |
| 10 | registerHook 一个入口 | ② | 插件不应决定用 hook 还是 event |
| 11 | ProcessorResult 三态 | ④ | 管线需要暂停语义 |
| 12 | SerializablePipelineContext 子集 | ④ | checkpoint round-trip 必须完整 |
| 13 | AbortSignal 双重检查 (框架 + 全局) | ④ | 每个边界可中断，覆盖 LLM 长调用场景 |
| 14 | gateLLM / gateTool 门控 stage | ④ | 控制门 = Processor at gate stage |
| 15 | StateMachine 6 状态 + error 可恢复 | ③④ | 状态转移显式化，可恢复 error 与 retry 对齐 |
| 16 | 构造函数注入全部依赖 | ③ | Agent 不创建自己的依赖 |
| 17 | Harness 拥有 lifecycle + teardown | ③ | setup/run/teardown 由框架管控 |
| 18 | 无全局单例 | ③ | 全局 = 不可隔离 = 不可测试 |
| 19 | SuspensionSignal 支持 expiresAt/ttl | ④ | 防止无限期挂起 |

---

## 九、当前架构差距（已代码验证）

所有差距已通过代码审查验证属实。Phase 1 修复的项标记为 ~~删除线~~。

| # | 差距 | 涉及决策 | 优先级 | 状态 | 代码证据 |
|---|------|---------|--------|------|---------|
| 1 | ~~EventBus 10/12 事件从未发射~~ | 6, 9 | P0 | **已修复** | `agent.ts:45` — `runner.setHookManager()` |
| 2 | ~~HookManager 11/12 hook 从未调用~~ | 1, 10 | P0 | **已修复** | 同上，根因一致 |
| 3 | ~~PipelineRunner 不调用 hooks~~ | 1, 6 | P0 | **已修复** | `pipeline.ts:47` — 新增 `setHookManager()` |
| 4 | ~~LLMInvoker 忽略 tracer~~ | 6, 7 | P0 | **已修复** | `llm-invoker.ts:48-92` — invoke() 中 tracer.startSpan/end |
| 5 | ~~Agent 不持有 EventBus~~ | 9, 10 | P0 | **已修复** | `agent.ts:69` — `get eventBus()` getter |
| 6 | ~~Agent 不调用 PluginManager.shutdown~~ | 17 | P1 | **已修复** | `agent.ts` — 新增 `teardown()` 调用 `pluginManager.shutdown()` |
| 7 | ~~ProcessorResult 只有二态 (缺 suspend)~~ | 11 | P1 | **已修复** | `sdk/index.ts` — `ProcessorResult = PipelineContext \| AbortSignal \| SuspensionSignal` |
| 8 | ~~Agent 构造函数不注入依赖~~ | 16 | P1 | **已修复** | `agent.ts` — 构造函数接受 `AgentDependencies` 接口 |
| 9 | ~~无 gateLLM / gateTool stage~~ | 14 | P1 | **已修复** | `sdk/index.ts` — PipelineStage 新增 `gateLLM` / `gateTool` |
| 10 | ~~全局 AbortSignal 只在循环顶部检查~~ | 13 | P1 | **已修复** | `pipeline.ts` — `run()/stream()` 接受 signal，stage 间检查 |
| 11 | ~~全局 defaultChain / customProviders~~ | 18 | P2 | **已修复** | `model-factory.ts` — ModelFactory 类封装，通过 DI 注入 |
| 12 | ~~Processor append-only (不可 replace/remove)~~ | 5 | P2 | **已修复** | `pipeline.ts` — 新增 `unregister()` / `replace()` |
| 13 | ~~无 StateMachine~~ | 15 | P2 | **已修复** | `state-machine.ts` — 6 状态 + 转移守卫 + error 可恢复 |
| 14 | ~~Session restore context 不完整~~ | 11, 12 | P2 | **已修复** | `session-manager.ts` — 从 `agent:start` 事件提取完整 config |
| 15 | ~~Permission onDecision 空操作~~ | 14 | P2 | **已修复** | `permission-processor.ts` — `api.emit('permission.decision', event)` |

---

## 十、实施路线图

### Phase 1: P0 超级修复 ✅ 已完成

**目标：** 激活已实现但未连接的 hook/event 基础设施。

```
Step 1: ✅ 修复 HookManager 接线
  文件: agent.ts, pipeline.ts
  改动: PipelineRunner 新增 setHookManager(); Agent 构造函数调用 runner.setHookManager()
  效果: 解除差距 #1, #2, #3

Step 2: ✅ 修复 LLMInvoker tracer 使用
  文件: llm-invoker.ts
  改动: invoke() 中 tracer.startSpan('llm.invoke') + setAttribute + try/finally end
  效果: 解除差距 #4

Step 3: ✅ Agent 持有 EventBus 引用
  文件: agent.ts, plugin-manager.ts
  改动: PluginManager 暴露 eventBus getter; Agent 新增 get eventBus()
  效果: 解除差距 #5

Step 4: ✅ 事件覆盖率测试
  文件: agent.test.ts, pipeline.test.ts, llm-invoker.test.ts
  内容: 10 个新测试覆盖 hook 触发、事件发射、tracer span、EventBus 接入
  结果: 325/325 全部通过，零回归
```

### Phase 2: P1 核心能力 ✅ 已完成

**目标：** 补齐 Processor 系统、依赖注入、门控 stage。

```
Step 1: ✅ ProcessorResult 三态
  文件: sdk/index.ts, pipeline.ts, agent.ts
  改动: ProcessorResult 增加 SuspensionSignal + PipelineCheckpoint; StreamEvent 增加 suspended; PipelineRunner 识别 suspend 短路
  效果: 解除差距 #7

Step 2: ✅ 依赖注入重构
  文件: agent.ts
  改动: 新增 AgentDependencies 接口; 构造函数接受 runner/registry/pluginManager/tracer
  效果: 解除差距 #8

Step 3: ✅ PipelineRunner 增加 unregister/replace
  文件: pipeline.ts
  改动: 新增 unregister(stage) 和 replace(stage, processor) 方法
  效果: 部分解除差距 #12 (Processor 可替换)

Step 4: ✅ gateLLM / gateTool stage
  文件: sdk/index.ts, agent.ts
  改动: PipelineStage 新增 gateLLM/gateTool; Agent 循环数组插入门控 stage
  效果: 解除差距 #9

Step 5: ✅ 全局 AbortSignal 透传
  文件: pipeline.ts, agent.ts
  改动: PipelineRunner.run()/stream() 接受 { signal } 参数; stage 间检查; Agent 透传 signal
  效果: 解除差距 #10

Step 6: ✅ Agent teardown 生命周期
  文件: agent.ts, plugin-manager.ts
  改动: Agent 新增 teardown(); PluginManager.shutdown() 变为幂等
  效果: 解除差距 #6
```

### Phase 3: P2 架构完善 ✅ 已完成

**目标：** 全局状态清理、状态机、checkpoint 完整性。

```
Step 1: ✅ ModelFactory 消除全局单例
  文件: model-factory.ts, agent.ts
  改动: 封装为 ModelFactory 类，通过 AgentDependencies.modelFactory 注入
  效果: 解除差距 #11

Step 2: ✅ StateMachine 实现
  文件: state-machine.ts
  改动: 6 状态 + 转移守卫 + error 可恢复 + onTransition 回调
  效果: 解除差距 #13

Step 3: ✅ SerializablePipelineContext
  文件: serialize.ts
  改动: 定义序列化子集 + serialize/deserialize 函数，剔除 fullStream/usagePromise/reasoningPromise/span
  效果: 解除差距 #14 (前置)

Step 4: ✅ Session restore 完整化
  文件: session-manager.ts
  改动: 从 agent:start 事件提取 agentConfig/promptFragments/toolDeclarations
  效果: 解除差距 #14

Step 5: ✅ Permission onDecision 接线
  文件: permission-processor.ts, sdk/index.ts, plugin-manager.ts
  改动: HarnessAPI 新增 emit; permissionPlugin 通过 api.emit('permission.decision', event) 发射审计事件
  效果: 解除差距 #15

测试: 28 个新测试，369 总测试通过，零回归
```

### Phase 依赖图

```
Phase 1 (P0 超级修复)
  │
  ├── Step 1 (HookManager 接线)  ← 根因修复，解除 #1 #2 #3
  ├── Step 2 (LLMInvoker tracer)
  ├── Step 3 (Agent 持 EventBus)
  └── Step 4 (覆盖率测试)
        │
Phase 2 (P1 核心能力)
  │
  ├── Step 1 (三态 ProcessorResult)
  │     └── Step 4 (gateLLM/gateTool)
  ├── Step 2 (依赖注入) ─── Step 6 (teardown)
  ├── Step 3 (unregister/replace)
  └── Step 5 (全局 AbortSignal 透传)
        │
Phase 3 (P2 架构完善)
  │
  ├── Step 1 (ModelFactory) ←── Phase 2 Step 2
  ├── Step 2 (StateMachine)  ←── Phase 2 Step 1
  ├── Step 3 (序列化)       ←── Phase 2 Step 1
  │     └── Step 4 (Session restore)
  └── Step 5 (Permission)   ←── Phase 1
```
