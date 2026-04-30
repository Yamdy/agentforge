# 移除 RxJS 全栈重构设计 ✅ [COMPLETED 2026-04-30]

> 状态：**已完成** — RxJS 已完全移除，1553 测试全部通过，DeepSeek E2E 验证通过
> 依赖：24-ARCH-REFACTOR.md（内核重构，已同步完成）

---

## 1. 动机

RxJS 在新架构下失去了存在价值。核心循环变为 imperative `while(true)` + `await`，Hook 切面用 `(input, output) => Promise<void>` 替代了流拦截，操作符关注点全部被 Hook 吸收。保留 RxJS 的唯一意义——多订阅者分发——被 50 行的 `AgentEventEmitter` 完全覆盖。

去掉后：依赖减少 30KB gzipped，public API 从 `run$() → Observable` 简化为 `run() → Promise<string>`，插件从 concatMap/tap 管道变为 Hook 注册函数，所有因 RxJS 产生的阻抗匹配（手动 Observable 构造器、StepContext 不可变传递、40+ → ~18 事件类型）全部消失。

---

## 2. 影响全貌

### 2.1 文件分类

```
src/ (49)
├── 🔴 删除
│   ├── operators/          (5 files) — 全部 RxJS 自定义操作符
│   └── loop/handlers/      (6 files) — 内联到循环体
│
├── 🟡 重写
│   ├── loop/agent-loop.ts           → async function while(true) + emit()
│   ├── plugins/plugin.ts            → HookFn 接口替代 Interceptor/Observer
│   ├── plugins/pipeline.ts          → buildPluginPipeline → applyHooks
│   ├── plugins/manager.ts           → 适配 HookRegistry
│   ├── plugins/*.ts (4 more)        → 插件改用 Hook 切面
│   ├── api/create-agent.ts (997行)  → Agent.run() return Promise
│   ├── api/agent-loop.ts (297行)    → 简化
│   ├── api/types.ts (439行)         → 移除 Observable 类型引用
│   ├── api/index.ts                 → 更新导出
│   ├── api/run-agent.ts             → 简化
│   ├── quickstart.ts (255行)        → 简化
│   └── subagent/types.ts            → 移除 Observable
│
├── 🟢 适配（小改）
│   ├── core/events.ts               → 事件类型精简（40+ → ~15）
│   ├── core/state.ts                → 移除 StepContext 相关
│   ├── core/context.ts              → 移除 StepContext
│   ├── core/context-builder.ts      → 移除 rxjs import
│   ├── core/interfaces.ts           → 移除 Observable 引用
│   ├── core/approval-channel.ts     → Promise 替代 Observable
│   ├── a2a/* (3 files)              → stream 事件 → callback
│   ├── workflow/* (3 files)         → Observable → callback
│   ├── subagent/registry.ts         → 移除 Observable
│   ├── mcp/client.ts                → Observable → callback
│   ├── adapters/* (6 files)         → stream() → async generator
│   ├── memory/compaction.ts         → 移除 rxjs import
│   ├── security/permission/* (2)    → Observable → callback
│   ├── skill/watcher.ts             → Observable → callback
│   ├── observability/resource-monitor.ts → 移除 rxjs
│   ├── tools/todo-list.ts           → 移除 rxjs
│   └── index.ts (1022行)            → 移除 operator 导出
│
tests/ (28)
├── 🔴 删除 — operators/*.test.ts (4 files)
├── 🟡 重写 — loop/*.spec.ts, api/*.spec.ts, plugins/*.test.ts, a2a/*.test.ts, workflow/*.spec.ts
└── 🟢 适配 — 其余测试

examples/ (10)
├── 🔴 删除 — 02-operators.ts（操作符示例）
└── 🟡 重写 — 其余 9 个示例（Observable → Promise）
```

### 2.2 Package.json 变更

```diff
- "rxjs": "^7.0.0",           // dependencies
- "rxjs": "^7.0.0",           // peerDependencies
```

---

## 3. 核心替换映射

### 3.1 Observable → AgentEventEmitter

```typescript
// src/core/events.ts 新增

/**
 * Agent event emitter — 替代 RxJS Subject/Observable 的多订阅者分发。
 * 50 行实现，无需外部依赖。
 */
export class AgentEventEmitter<T extends AgentEvent = AgentEvent> {
  private listeners = new Set<(event: T) => void | Promise<void>>()

  /** 订阅事件流，返回取消函数 */
  on(listener: (event: T) => void | Promise<void>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 通配订阅 — 所有事件 */
  onAny(listener: (event: T) => void | Promise<void>): () => void {
    return this.on(listener)
  }

  /** 发射事件 — 异步执行所有监听器，异常隔离 */
  async emit(event: T): Promise<void> {
    const promises: Promise<void>[] = []
    for (const listener of this.listeners) {
      promises.push(
        Promise.resolve(listener(event)).catch(_ => { /* 隔离 */ })
      )
    }
    await Promise.allSettled(promises)
  }

  /** 移除所有监听器 */
  clear(): void { this.listeners.clear() }

  /** 监听器数量 */
  get size(): number { return this.listeners.size }
}
```

### 3.2 RxJS 操作符 → Hook 或原生实现

| RxJS 操作符 | 替代 |
|------------|------|
| `takeUntil(destroy$)` | `AbortController.signal.aborted` 检查 |
| `catchError(handler)` | `try/catch` |
| `retryOnEventType('agent.error', 3)` | `for (let i=0; i<3; i++)` + `continue` |
| `timeoutOnEventType('done', 30000)` | `AbortController` + `setTimeout(30000, abort)` |
| `filterEventType('llm.response')` | Hook `llm.response.after` |
| `recordMetrics({ increment })` | Hook `step.end` 中调用 `metrics.increment()` |
| `concatMap` (插件拦截) | Hook 注册 + `runHook()` 串行调用 |
| `tap` (插件观察) | EventEmitter `on()` |
| `finalize` | `try/finally` |
| `expand` (递归) | `while(true)` |
| `of(...events)` | `emit(event1); emit(event2)` |
| `from(promise)` | `await promise` |
| `EMPTY` | `return`（终止） |
| `Subject` | `AgentEventEmitter` |
| `firstValueFrom(stream)` | `agent.run()` 返回 Promise |
| `Observable.subscribe()` | `emitter.on(callback)` |
| `Subscription.unsubscribe()` | `emitter.on()` 返回的取消函数 |

### 3.3 LLM Adapter 流式接口 → AsyncGenerator

```typescript
// 改前
interface LLMAdapter {
  stream(messages, options): Observable<LLMChunk>
}

// 改后
interface LLMAdapter {
  stream(messages, options): AsyncGenerator<LLMChunk>
}
```

实现端从 `new Observable(subscriber => {...})` 变成 `async function* stream(...) { yield* ... }` — 更自然。

---

## 4. 新 API 设计

### 4.1 L2 API（创建 Agent）

```typescript
// 改前
const agent = createAgent(config)
const events$ = agent.run$('hello')          // Observable
const result$ = agent.stream('hello', {...})  // Subscription
const output = await agent.suspend('hello')   // Promise<string>

// 改后
const agent = createAgent(config)

// 主接口：返回 Promise<string>
const output = await agent.run('hello')

// 流式回调：实时接收事件（替代 Observable.subscribe）
agent.run('hello', {
  onToken: (delta: string) => process.stdout.write(delta),
  onToolCall: (tool: ToolCallEvent) => console.log(`Calling ${tool.name}...`),
  onToolResult: (result: ToolResultEvent) => console.log(`Result: ${result.result}`),
  onComplete: (output: string) => console.log('Done:', output),
  onError: (error: AgentErrorEvent) => console.error('Error:', error),
})

// 事件监听器（替代 Observable.subscribe）
agent.on('llm.response', (event) => auditLog.append(event))
agent.on('tool.result', (event) => metrics.record(event))

// 取消
agent.cancel()   // 立即终止底层 LLM 请求和工具进程
```

### 4.2 Agent 接口

```typescript
// src/api/types.ts

export interface Agent {
  /** 运行 Agent，返回完整输出 */
  run(input: string, handlers?: RunHandlers): Promise<string>

  /** 订阅特定事件类型 */
  on(eventType: AgentEventType, listener: (event: AgentEvent) => void): () => void

  /** 取消执行 */
  cancel(): void

  /** 暂停（保留状态可恢复） */
  pause(): Promise<void>

  /** 恢复 */
  resume(): void

  /** 获取当前状态 */
  getState(): AgentLoopState

  /** 销毁（清理所有资源） */
  destroy(): void
}

/** 流式运行回调 */
export interface RunHandlers {
  onToken?: (delta: string) => void
  onToolCall?: (call: ToolCallEvent) => void
  onToolResult?: (result: ToolResultEvent) => void
  onComplete?: (output: string) => void
  onError?: (error: AgentErrorEvent) => void
  onEvent?: (event: AgentEvent) => void    // 通配
}
```

### 4.3 L3 API（直接使用 AgentLoop）

```typescript
// 改前
const loop = createAgentLoop(ctx, config)
loop.run$('hello').pipe(
  filter(e => e.type === 'llm.response'),
  takeUntil(destroy$),
).subscribe({ ... })

// 改后
const loop = createAgentLoop(ctx, config)
loop.on('llm.response', (event) => console.log(event))
loop.on('tool.result', (event) => metrics.record(event))
const output = await loop.run('hello')
```

### 4.4 Quickstart API

```typescript
// 改前
const result = await agent.generate('What is the weather?')  // 需要 firstValueFrom
console.log(result.text)

// 改后 — 接口不变，内部实现简化
const result = await agent.generate('What is the weather?')
console.log(result.text)
```

---

## 5. 子系统适配

### 5.1 A2A

```typescript
// 改前 — Observable 流
client.onMessage(): Observable<A2AMessage>
connection.onEvent(): Observable<ConnectionEvent>

// 改后 — callback
client.onMessage(handler: (msg: A2AMessage) => void): () => void
connection.onEvent(handler: (ev: ConnectionEvent) => void): () => void
```

A2A 保持现有的 `request()`/`notify()`/`broadcast()` Promise 接口不变，只改 `on*` 观察接口。

### 5.2 Workflow

```typescript
// 改前
workflow.run(input).subscribe(console.log)

// 改后
workflow.on('step.start', (ev) => console.log(ev))
const result = await workflow.run(input)
console.log(result)
```

### 5.3 Plugin 系统

Plugin 在新架构下通过两种接口覆盖原有的 Interceptor 全部能力。

#### RequestHook — 修改 LLM 请求前消息（替代 Interceptor 的修改事件能力）

```typescript
// src/core/hooks.ts

/**
 * 请求前 Hook — 在 llm.chat() 之前修改消息列表。
 * 替代旧架构中 InterceptorPlugin 对 llm.request 事件的拦截。
 *
 * 典型用例：MemoryPlugin prepend 记忆、SkillsPlugin 注入 skill prompt、
 * SummarizationPlugin 插入压缩摘要。
 */
export interface RequestHook {
  name: string
  priority: number  // 越小越先执行
  /** 修改即将发送给 LLM 的消息列表。返回新数组。 */
  apply(messages: Message[], state: AgentLoopState): Message[] | Promise<Message[]>
}

// 在 loop() 中调用
async function loop(state) {
  while (true) {
    let messages = state.messages
    // RequestHook 串行执行 — 每个 hook 的输出是下一个的输入
    for (const hook of sortedRequestHooks) {
      messages = await hook.apply(messages, state)
    }
    const resp = await llm.chat(messages)
    // ...
  }
}
```

**MemoryPlugin 在新接口下：**

```typescript
const memoryHook: RequestHook = {
  name: 'memory',
  priority: 10,
  apply: async (messages) => {
    const entries = await memory.load()
    const systemMsg = { role: 'system', content: formatMemory(entries) }
    return [systemMsg, ...messages]
  }
}
```

#### ToolHook — 工具执行前检查/阻断（替代 Interceptor 的 EMPTY 阻断能力）

```typescript
/**
 * 工具执行前 Hook — 在工具执行前检查权限或阻断。
 * 替代旧架构中 PermissionPlugin 通过返回 EMPTY 阻断流程的能力。
 */
export interface ToolHook {
  name: string
  priority: number
  /**
   * 在工具执行前调用。
   * 返回 true = 允许执行，返回 false = 阻断（工具标记为 permission_denied）
   */
  beforeExecute(tool: ToolCall, state: AgentLoopState): Promise<boolean>
}

// 在 loop() 中调用 — 每个工具执行前
for (const tc of toolCalls) {
  let allowed = true
  for (const hook of sortedToolHooks) {
    if (!(await hook.beforeExecute(tc, state))) {
      allowed = false
      break
    }
  }
  if (!allowed) {
    emit({ type: 'tool.result', result: 'Permission denied', isError: true, ... })
    continue
  }
  const result = await ctx.tools.execute(tc.name, tc.args)
  emit({ type: 'tool.result', ...result })
}
```

**PermissionPlugin 在新接口下：**

```typescript
const permissionHook: ToolHook = {
  name: 'permission',
  priority: 5,
  beforeExecute: async (tool) => {
    if (tool.name === 'bash' && isDangerous(tool.args)) return false
    if (tool.riskLevel === 'critical') return await askUser(tool)
    return true
  }
}
```

#### Observer — 纯观察（替代 ObserverPlugin）

```typescript
interface Plugin {
  name: string
  /** 注册 RequestHook（修改 LLM 请求前消息） */
  requestHooks?: RequestHook[]
  /** 注册 ToolHook（工具执行前检查） */
  toolHooks?: ToolHook[]
  /** 生命周期 Hook（从 24 号设计） */
  lifecycleHooks?: HookRegistration[]
  /** 想订阅哪些事件（纯观察，不阻塞） */
  eventSubscriptions?: Array<{
    event: AgentEventType
    handler: (e: AgentEvent) => void | Promise<void>
  }>
}
```

---

## 6. AgentEventEmitter 细节

### 6.1 类型安全的按事件订阅

```typescript
// src/core/events.ts

export interface TypedEmitter {
  on<T extends AgentEvent>(
    eventType: T['type'],
    listener: (event: T) => void | Promise<void>
  ): () => void

  onAny(listener: (event: AgentEvent) => void | Promise<void>): () => void

  emit(event: AgentEvent): Promise<void>
}

export class AgentEventEmitterImpl implements TypedEmitter {
  private typed = new Map<string, Set<(event: any) => void>>()
  private any = new Set<(event: AgentEvent) => void>()

  on<T extends AgentEvent>(eventType: T['type'], listener: (event: T) => void): () => void {
    const set = this.typed.get(eventType) ?? new Set()
    set.add(listener)
    this.typed.set(eventType, set)
    return () => set.delete(listener)
  }

  onAny(listener: (event: AgentEvent) => void): () => void {
    this.any.add(listener)
    return () => this.any.delete(listener)
  }

  async emit(event: AgentEvent): Promise<void> {
    const promises: Promise<void>[] = []
    // 按类型
    for (const fn of (this.typed.get(event.type) ?? [])) {
      promises.push(Promise.resolve(fn(event)).catch(() => {}))
    }
    // 通配
    for (const fn of this.any) {
      promises.push(Promise.resolve(fn(event)).catch(() => {}))
    }
    await Promise.allSettled(promises)
  }
}
```

### 6.2 为什么不用 Node.js EventEmitter

| Node.js EventEmitter | AgentEventEmitter |
|---------------------|-------------------|
| 字符串事件名，无类型推断 | 泛型 `<T extends AgentEvent>`，类型安全的 `on('tool.result', ...)` |
| 同步执行监听器 | 异步执行（`Promise.allSettled`），Hook 可以 await |
| `emit()` 返回值是 boolean | `emit()` 返回 `Promise<void>`，调用者可以 await 所有监听器完成 |
| 错误会传播（`error` 事件） | 错误自动隔离，永不传播 |

50 行封装，不需要引入 Node.js 的 `EventEmitter`。

---

## 7. 事件类型精简

### 7.1 保留的事件（~18 个）

```typescript
// src/core/events.ts

export const AgentEventTypeSchema = z.enum([
  // ── 生命周期 ──
  'agent.start',
  'agent.complete',
  'agent.error',
  'done',

  // ── LLM ──
  'llm.response',         // 完整响应（Plugin/Hook 观察、审计）
  'llm.stream.text',      // 流式文本增量（UI 实时显示）

  // ── 工具（有外部消费者：指标收集、UI 渲染、审计日志）──
  'tool.call',            // 工具调用发起
  'tool.execute',         // 工具开始执行（记录耗时起点）
  'tool.result',          // 工具执行结果
  'tool.error',           // 工具执行失败

  // ── HITL（有外部消费者：UI 审批界面）──
  'hitl.ask',
  'hitl.answer',

  // ── Checkpoint（有外部消费者：持久化存储）──
  'checkpoint',

  // ── 子系统生命周期 ──
  'subagent.start',
  'subagent.complete',
  'subagent.error',
  'mcp.connected',
  'mcp.disconnected',
])
```

### 7.2 删除的事件（~25 个）

```
llm.request          — 内部循环知道要调 LLM，外部不需要事件
llm.stream.start     — 流细节，llm.stream.text + llm.response 足够
llm.stream.tool_call — 流细节，tool.call 覆盖
llm.stream.end       — 流细节
llm.error            — 合入 agent.error
llm.output.invalid   — 内部修复循环，外部不感知
tool.batch           — Promise.all 内部执行，外部不需要批次事件
tool.batch.start     — 同上
tool.batch.complete  — 同上
state.change         — 外部读 agent.getState()，不需要事件
cancel               — abortSignal 传播
compaction.start     — 压缩是内存操作，外部不感知
compaction.complete  — 同上
permission.prompt    — 合入 tool.execute.before hook
permission.decision  — 合入 tool.execute.before hook
decision.trace       — 合入 hook 审计能力
workflow.step.start  — 步骤细节，workflow.start/complete 足够
workflow.step.end    — 同上
workflow.suspend     — 同上
workflow.resume      — 同上
mcp.tools_changed    — 不常用，有 mcp.connected 足够
mcp.error            — 合入 agent.error
```

---

## 8. 实施计划

### Day 1 — 基础设施
- [ ] 实现 `AgentEventEmitter`
- [ ] 实现 `HookRegistry`（已在 24 号设计）
- [ ] 精简 `src/core/events.ts`（40+ → ~18 事件类型）
- [ ] 清理 `src/core/state.ts`（移除 StepContext 等）
- [ ] 清理 `src/core/interfaces.ts`（移除 Observable 引用）

### Day 2 — 核心循环 + API
- [ ] 重写 `src/loop/agent-loop.ts`（imperative while(true)）
- [ ] 删除 `src/loop/handlers/*`
- [ ] 重写 `src/api/create-agent.ts`（Promise 接口）
- [ ] 重写 `src/api/agent-loop.ts`
- [ ] 更新 `src/api/types.ts`
- [ ] 更新 `src/quickstart.ts`

### Day 3 — 子系统适配
- [ ] 适配 `src/plugins/*`（Hook 模式）
- [ ] 适配 `src/a2a/*`（callback）
- [ ] 适配 `src/workflow/*`（callback）
- [ ] 适配 `src/subagent/*`
- [ ] 适配 `src/mcp/*`、`src/memory/*`
- [ ] 适配 `src/adapters/*`（stream → AsyncGenerator）
- [ ] 适配 `src/security/*`
- [ ] 适配 `src/skill/watcher.ts`
- [ ] 适配 `src/tools/todo-list.ts`

### Day 4 — 清理 + 测试
- [ ] 删除 `src/operators/*`（5 个文件）
- [ ] 更新 `src/index.ts`（移除 operator 导出）
- [ ] 重写 `tests/loop/*`（核心循环测试）
- [ ] 重写 `tests/api/*`
- [ ] 重写 `tests/plugins/*`
- [ ] 删除 `tests/operators/*`（4 个文件）
- [ ] 适配其他 20 个测试文件
- [ ] 更新 `examples/*`（10 个文件）

### Day 4.5 — 收尾
- [ ] 更新 `package.json`（移除 rxjs 依赖）
- [ ] 更新文档/README
- [ ] 全量测试通过
- [ ] 构建通过

---

## 9. 涉及文件总清单

### 删除（11 文件）
```
src/operators/control.ts
src/operators/transform.ts
src/operators/notify.ts
src/operators/presets.ts
src/operators/index.ts
src/loop/handlers/lifecycle.ts
src/loop/handlers/llm.ts
src/loop/handlers/tool-execution.ts
src/loop/handlers/hitl.ts
src/loop/handlers/subagent.ts
src/loop/handlers/index.ts
tests/operators/control.test.ts
tests/operators/transform.test.ts
tests/operators/notify.test.ts
tests/operators/presets.test.ts
examples/02-operators.ts
```

### 重写（~25 文件）
```
src/loop/agent-loop.ts
src/plugins/plugin.ts
src/plugins/pipeline.ts
src/plugins/manager.ts
src/plugins/skills-plugin.ts
src/plugins/memory-plugin.ts
src/plugins/summarization-plugin.ts
src/api/create-agent.ts
src/api/agent-loop.ts
src/api/types.ts
src/api/index.ts
src/api/run-agent.ts
src/quickstart.ts
src/subagent/types.ts
src/subagent/registry.ts
tests/loop/agent-loop.spec.ts
tests/loop/handlers/* (4 files)
tests/api/create-agent.spec.ts
tests/api/preset-service-wiring.spec.ts
tests/plugins/* (2 files)
tests/agent-loop.spec.ts
examples/* (9 files)
```

### 适配（~51 文件）
```
src/core/events.ts
src/core/state.ts
src/core/context.ts
src/core/context-builder.ts
src/core/interfaces.ts
src/core/approval-channel.ts
src/a2a/transport.ts
src/a2a/connection.ts
src/a2a/client.ts
src/workflow/workflow.ts
src/workflow/pipeline.ts
src/workflow/executor.ts
src/mcp/client.ts
src/memory/compaction.ts
src/security/permission/permission-guard.ts
src/security/permission/permission-controller.ts
src/skill/watcher.ts
src/observability/resource-monitor.ts
src/tools/todo-list.ts
src/adapters/openai.ts
src/adapters/anthropic.ts
src/adapters/google.ts
src/adapters/ollama.ts
src/adapters/openai-http.ts
src/adapters/adapter-system.ts
src/adapters/index.ts
src/index.ts
tests/a2a/* (3 files)
tests/workflow/* (1 file)
tests/mcp/* (1 file)
tests/memory/* (2 files)
tests/subagent/* (2 files)
tests/integration/* (2 files)
tests/e2e/* (2 files)
tests/tools/* (1 file)
tests/loop/streaming-operators.spec.ts
... (约 10 more)
```
