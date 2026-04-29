# AgentForge 重构实施计划

> 阶段：6 Phase，5 天
> 涉及：87 文件 → 72 文件（删 15，重写 15，适配 35，不动 22）
> 前置：24-ARCH-REFACTOR / 25-DE-RXJS / 26-FRAMEWORK-COMPARISON

---

## 实施顺序（依赖图）

```
Phase 1: 基础设施（无依赖）
  events.ts → state.ts → hooks.ts → AgentEventEmitter
      ↓
Phase 2: 核心循环（依赖 Phase 1）
  agent-loop.ts (new) + token-budget.ts + error-analyzer.ts
      ↓
Phase 3: 插件系统（依赖 Phase 1+2）
  plugin.ts → pipeline.ts → manager.ts → plugins/*
      ↓
Phase 4: API 层（依赖 Phase 1-3）
  create-agent.ts → agent-loop.ts → types.ts → quickstart.ts → index.ts
      ↓
Phase 5: 子系统适配（依赖 Phase 4）
  adapters/ → a2a/ → workflow/ → subagent/ → mcp/ → memory/ → security/ → skill/
      ↓
Phase 6: 测试 + 清理（依赖 Phase 1-5）
  tests/ → 删除 operators/ + handlers/ → 验证全量通过
```

---

## Phase 1: 基础设施 (Day 1)

### 文件: `src/core/events.ts`

**变更**: 40+ event types → 18. 删除无消费者的中间事件，保留有真实订阅者的事件。

```typescript
// ── 保留（18 个）──
export const AgentEventTypeSchema = z.enum([
  'agent.start', 'agent.complete', 'agent.error', 'done',
  'llm.response', 'llm.stream.text',
  'tool.call', 'tool.execute', 'tool.result', 'tool.error',
  'hitl.ask', 'hitl.answer',
  'checkpoint',
  'subagent.start', 'subagent.complete', 'subagent.error',
  'mcp.connected', 'mcp.disconnected',
])

// ── 新增：EventEmitter ──
export class AgentEventEmitter {
  private typed = new Map<string, Set<(e: any) => void>>()
  private any = new Set<(e: AgentEvent) => void>()

  on<E extends AgentEvent>(type: E['type'], fn: (e: E) => void): () => void {
    const set = this.typed.get(type) ?? new Set()
    set.add(fn)
    this.typed.set(type, set)
    return () => set.delete(fn)
  }

  onAny(fn: (e: AgentEvent) => void): () => void {
    this.any.add(fn)
    return () => this.any.delete(fn)
  }

  async emit(event: AgentEvent): Promise<void> {
    const ps: Promise<void>[] = []
    for (const fn of this.typed.get(event.type) ?? []) ps.push(Promise.resolve(fn(event)).catch(() => {}))
    for (const fn of this.any) ps.push(Promise.resolve(fn(event)).catch(() => {}))
    await Promise.allSettled(ps)
  }
}
```

### 文件: `src/core/state.ts`

**变更**: 添加 `AgentLoopState`（替代当前分散在各处的状态字段），添加 `RecoveryState`，移除 `StepContext`/`BatchContext`/`ContextManagement`（这些在新循环中不再需要独立类型）。

```typescript
// ── 核心运行状态（替代 StepContext + AgentState 的部分字段）──
export interface AgentLoopState {
  sessionId: string
  agentName: string
  model: ModelConfig
  messages: Message[]
  step: number
  maxSteps: number
  tokens: { prompt: number; completion: number }
  output: string
  // 恢复状态
  recovery: RecoveryState
  // 预算追踪
  budget: TokenBudgetState
}

export interface RecoveryState {
  outputTokenEscalationCount: number
  recoveryMessageCount: number
  fallbackSwitchCount: number
  compactionRetryCount: number
}

export interface TokenBudgetState {
  continuationCount: number
  lastDeltaTokens: number
  lastGlobalTurnTokens: number
  startedAt: number
}

export function createInitialLoopState(opts: {
  sessionId: string; agentName: string; model: ModelConfig;
  messages: Message[]; maxSteps: number;
}): AgentLoopState {
  return {
    sessionId: opts.sessionId,
    agentName: opts.agentName,
    model: opts.model,
    messages: opts.messages,
    step: 0,
    maxSteps: opts.maxSteps,
    tokens: { prompt: 0, completion: 0 },
    output: '',
    recovery: { outputTokenEscalationCount: 0, recoveryMessageCount: 0, fallbackSwitchCount: 0, compactionRetryCount: 0 },
    budget: { continuationCount: 0, lastDeltaTokens: 0, lastGlobalTurnTokens: 0, startedAt: Date.now() },
  }
}
```

### 文件: `src/core/hooks.ts` (新)

从 24-ARCH-REFACTOR §3 提取完整实现。包括 `HookRegistry`、全部 HookName 枚举、RequestHook、ToolHook。

### 文件: `src/core/interfaces.ts`

**变更**: 移除所有 `Observable` 引用。`LLMAdapter.stream()` 返回类型从 `Observable<LLMChunk>` 改为 `AsyncGenerator<LLMChunk>`。`HITLController.ask()` 从 `Observable<string>` 改为 `Promise<string>`（直接 await）。

### 文件: `src/core/context.ts`

**变更**: 添加 `hookRegistry?: HookRegistry` 字段到 `AgentContext`。移除 `StepContext` 导出。

---

## Phase 2: 核心循环 (Day 1-2)

### 文件: `src/loop/agent-loop.ts`（完全重写，~350 行）

**删除**: 所有 handler import、`expand`/`mergeMap`/`catchError` 等 RxJS 操作符、`StepContext` 类型、`switch(event.type)` 分发。

**新实现**:

```typescript
// src/loop/agent-loop.ts

import { AgentEventEmitter } from '../core/events.js'
import { type AgentContext, type AgentLoopState, createInitialLoopState } from '../core/index.js'
import { HookRegistry, type RequestHook, type ToolHook } from '../core/hooks.js'
import { checkTokenBudget, createBudgetTracker } from './token-budget.js'
import { analyzeLLMError, RECOVERY_LIMITS, ESCALATED_MAX_OUTPUT_TOKENS } from './error-analyzer.js'
import { partitionToolCalls } from './tool-partition.js'

export interface AgentLoopConfig {
  model: { provider: string; model: string }
  maxSteps?: number
  maxLLMRepairAttempts?: number
  parallelToolCalls?: boolean
  streaming?: boolean
  tokenBudget?: number
  fallbackModel?: { provider: string; model: string }
  history?: Message[]
  systemPrompt?: string
}

export function createAgentLoop(ctx: AgentContext, config: AgentLoopConfig) {
  const emitter = new AgentEventEmitter()
  const hooks = ctx.hookRegistry ?? new HookRegistry()
  const abortController = new AbortController()
  let state: AgentLoopState | null = null
  let paused = false
  let resumePromise: Promise<void> | null = null
  let resumeResolve: (() => void) | null = null

  const emit = (event: AgentEvent) => emitter.emit(event)

  async function run(input: string): Promise<string> {
    abortController.abort() // 取消上一轮（如果有）
    const ac = new AbortController()
    const signal = ac.signal

    state = createInitialLoopState({
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
      model: config.model,
      messages: [
        ...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt } as Message] : []),
        ...(config.history ?? []),
        { role: 'user', content: input } as Message,
      ],
      maxSteps: config.maxSteps ?? 10,
    })

    const maxSteps = state.maxSteps
    const budgetTracker = createBudgetTracker()

    emit({ type: 'agent.start', timestamp: Date.now(), sessionId: ctx.sessionId, input, agentName: ctx.agentName })

    // Hook: session.start
    for (const h of hooks.getLifecycleHooks('session.start')) {
      await h({ sessionId: ctx.sessionId, agentName: ctx.agentName, input, model: config.model }, {})
    }

    // ===== 主循环 =====
    try {
      while (true) {
        if (signal.aborted) break
        if (paused) await resumePromise
        if (state!.step >= maxSteps) {
          emit({ type: 'agent.complete', timestamp: Date.now(), sessionId: ctx.sessionId, output: state!.output, steps: state!.step })
          emit({ type: 'done', timestamp: Date.now(), sessionId: ctx.sessionId, reason: 'length' })
          return state!.output
        }

        await runLifecycleHook('step.begin', { sessionId: ctx.sessionId, step: state!.step, maxSteps, messageCount: state!.messages.length }, {})

        // ── 1. Request Hooks: 修改 messages ──
        let messages = state!.messages
        for (const h of hooks.getRequestHooks()) {
          messages = await h.apply(messages, state!)
        }

        // ── 2. LLM 调用 ──
        emit({ type: 'llm.request', timestamp: Date.now(), sessionId: ctx.sessionId, messages, model: config.model, tools: ctx.tools.list() })

        let response: LLMResponse
        try {
          response = await ctx.llm.chat(messages, { signal, tools: ctx.tools.getFunctionDefs() })
          state!.tokens.prompt += response.usage?.promptTokens ?? 0
          state!.tokens.completion += response.usage?.completionTokens ?? 0
        } catch (error) {
          const recovery = await handleLLMError(error, signal)
          if (recovery === 'continue') { state!.step++; continue }
          throw error
        }

        emit({ type: 'llm.response', timestamp: Date.now(), sessionId: ctx.sessionId, content: response.content, toolCalls: response.toolCalls, finishReason: response.finishReason, usage: response.usage })

        await runLifecycleHook('llm.response.after', { sessionId: ctx.sessionId, step: state!.step, response, usage: response.usage }, {})

        // ── 3. 完成检测 + Token 预算 ──
        if (response.finishReason === 'stop' || !response.toolCalls?.length) {
          const decision = checkTokenBudget(budgetTracker, config.tokenBudget ?? 200_000, state!.tokens)
          if (decision === 'continue') {
            state!.messages.push({ role: 'user', content: decision.nudgeMessage } as Message)
            state!.step++
            continue
          }
          state!.output = response.content
          await runLifecycleHook('session.end', { sessionId: ctx.sessionId, reason: 'completed', steps: state!.step, tokens: state!.tokens }, {})
          emit({ type: 'agent.complete', timestamp: Date.now(), sessionId: ctx.sessionId, output: response.content, steps: state!.step })
          emit({ type: 'done', timestamp: Date.now(), sessionId: ctx.sessionId, reason: 'stop' })
          return response.content
        }

        // ── 4. 工具执行 ──
        const batches = partitionToolCalls(response.toolCalls, ctx.tools)
        const toolResults: Message[] = []

        for (const batch of batches) {
          if (signal.aborted) break

          if (batch.isConcurrencySafe && batch.calls.length > 1) {
            // 并行
            const results = await Promise.all(batch.calls.map(async tc => {
              if (signal.aborted) return { tc, result: 'Cancelled', isError: true }

              emit({ type: 'tool.call', timestamp: Date.now(), sessionId: ctx.sessionId, toolCallId: tc.id, toolName: tc.name, args: tc.args })

              // ToolHook: 执行前检查
              for (const h of hooks.getToolHooks()) {
                if (!(await h.beforeExecute(tc, state!))) {
                  return { tc, result: 'Permission denied', isError: true }
                }
              }

              try {
                emit({ type: 'tool.execute', timestamp: Date.now(), sessionId: ctx.sessionId, toolCallId: tc.id, toolName: tc.name })
                const result = await ctx.tools.execute(tc.name, tc.args, { signal })
                await runLifecycleHook('tool.execute.after', { sessionId: ctx.sessionId, toolName: tc.name, callId: tc.id, args: tc.args }, { result })
                return { tc, result, isError: false }
              } catch (err) {
                await runLifecycleHook('tool.execute.error', { sessionId: ctx.sessionId, toolName: tc.name, callId: tc.id, error: err }, { retry: false })
                return { tc, result: String(err), isError: true }
              }
            }))

            for (const r of results) {
              emit({ type: 'tool.result', timestamp: Date.now(), sessionId: ctx.sessionId, toolCallId: r.tc.id, toolName: r.tc.name, result: r.result, isError: r.isError })
              toolResults.push({ role: 'tool', content: r.result, toolCallId: r.tc.id, name: r.tc.name } as Message)
            }
          } else {
            // 串行 — 逐个执行并累积状态
            for (const tc of batch.calls) {
              // ... 同上逻辑
            }
          }
        }

        // ── 5. 拼装消息，继续循环 ──
        state!.messages = [...state!.messages, ...toolResults]
        state!.step++

        // 压缩检查
        if (shouldCompact(state!.messages, state!.tokens)) {
          await runLifecycleHook('compaction.before', { sessionId: ctx.sessionId, messages: state!.messages, tokenCount: state!.tokens.prompt + state!.tokens.completion }, {})
          if (ctx.compactionManager) {
            const result = await ctx.compactionManager.compact({ sessionId: ctx.sessionId, messages: state!.messages, maxTokens: 8000, currentTokenEstimate: state!.tokens.prompt + state!.tokens.completion })
            state!.messages = result.messages as Message[]
          }
          await runLifecycleHook('compaction.after', { sessionId: ctx.sessionId, messages: state!.messages, tokenCount: estimateTokens(state!.messages) }, {})
        }
      }
    } catch (error) {
      emit({ type: 'agent.error', timestamp: Date.now(), sessionId: ctx.sessionId, error: { name: (error as Error).name, message: (error as Error).message } })
      emit({ type: 'done', timestamp: Date.now(), sessionId: ctx.sessionId, reason: 'error' })
      throw error
    }

    return state?.output ?? ''
  }

  // ── 恢复处理 ──
  async function handleLLMError(error: unknown, signal: AbortSignal): Promise<'continue' | 'throw'> {
    const analysis = analyzeLLMError(error as Error, undefined, (error as any).status)

    if (analysis.recoverable) {
      switch (analysis.recovery) {
        case 'escalate_output_tokens':
          if (state!.recovery.outputTokenEscalationCount < 1) {
            state!.recovery.outputTokenEscalationCount++
            return 'continue'  // 调用方用升级后的 maxTokens 重试
          }
          break
        case 'inject_recovery_message':
          if (state!.recovery.recoveryMessageCount < RECOVERY_LIMITS.recoveryMessage) {
            state!.recovery.recoveryMessageCount++
            state!.messages.push({ role: 'user', content: 'Output token limit hit. Resume directly — no apology, no recap.' } as Message)
            return 'continue'
          }
          break
        case 'switch_fallback_model':
          if (config.fallbackModel && state!.recovery.fallbackSwitchCount < 1) {
            state!.recovery.fallbackSwitchCount++
            state!.model = config.fallbackModel
            return 'continue'
          }
          break
        case 'trigger_compaction':
          if (ctx.compactionManager && state!.recovery.compactionRetryCount < 1) {
            state!.recovery.compactionRetryCount++
            const result = await ctx.compactionManager.compact({ sessionId: ctx.sessionId, messages: state!.messages, maxTokens: 8000, currentTokenEstimate: state!.tokens.prompt + state!.tokens.completion })
            state!.messages = result.messages as Message[]
            return 'continue'
          }
          break
      }
    }
    return 'throw'
  }

  // ── Hook 执行 ──
  async function runLifecycleHook(name: string, input: any, output: any): Promise<void> {
    for (const h of hooks.getLifecycleHooks(name as any)) {
      try { await h(input, output) } catch { /* 隔离 */ }
    }
  }

  return {
    run,
    on: emitter.on.bind(emitter),
    onAny: emitter.onAny.bind(emitter),
    cancel: () => abortController.abort(),
    pause: () => { paused = true; resumePromise = new Promise(r => { resumeResolve = r }) },
    resume: () => { paused = false; resumeResolve?.() },
    getState: () => state,
    destroy: () => { abortController.abort(); emitter.clear() },
  }
}
```

### 文件: `src/loop/token-budget.ts` (新)

从 21-TOKEN-BUDGET §2.2 提取。`checkTokenBudget()` 纯函数。

### 文件: `src/loop/error-analyzer.ts` (新)

从 22-ERROR-RECOVERY §2.2 提取。`analyzeLLMError()` 纯函数 + 常量。

### 文件: `src/loop/tool-partition.ts` (新)

从 23-TOOL-CONCURRENCY §2.2 提取。`partitionToolCalls()` 纯函数。

---

## Phase 3: 插件系统 (Day 2)

### 文件: `src/plugins/plugin.ts`（重写）

```typescript
// ── 新接口 ──
export interface Plugin {
  name: string
  /** 请求前 Hook — 修改 LLM 调用前的消息列表 */
  requestHooks?: RequestHook[]
  /** 工具执行前 Hook — 权限检查 / 阻断 */
  toolHooks?: ToolHook[]
  /** 生命周期 Hook */
  lifecycleHooks?: Array<{ name: HookName; fn: HookFn<any, any>; priority?: number }>
  /** 事件订阅（纯观察，不阻塞） */
  eventSubscriptions?: Array<{ event: string; handler: (e: any) => void | Promise<void> }>
}
```

### 文件: `src/plugins/pipeline.ts`（重写）

从 `buildPluginPipeline(source, plugins)` 变为 `applyPlugins(plugins, hookRegistry, emitter)`——注册 hook + 订阅事件。

### 文件: `src/plugins/manager.ts`（适配）

PluginManager 保持注册/注销接口不变，内部改为维护 HookRegistry + EventEmitter 订阅。

### 文件: `src/plugins/*.ts` (4 files)（重写）

MemoryPlugin、SkillsPlugin、SummarizationPlugin、LoggingPlugin——从 Interceptor/Observer 改为 RequestHook/ToolHook 实现。

**MemoryPlugin 迁移示例**:

```typescript
// 旧
class MemoryPlugin implements InterceptorPlugin {
  intercept(event: AgentEvent): Observable<AgentEvent> {
    if (event.type === 'llm.request') {
      return from(this.memory.load()).pipe(
        map(entries => ({
          ...event,
          messages: [formatMemory(entries), ...event.messages],
        }))
      )
    }
    return of(event)
  }
}

// 新
class MemoryPlugin implements Plugin {
  name = 'memory'
  requestHooks = [{
    name: 'memory-inject',
    priority: 10,
    apply: async (messages) => {
      const entries = await this.memory.load()
      return [formatMemory(entries), ...messages]
    }
  }]
}
```

---

## Phase 4: API 层 (Day 2-3)

### 文件: `src/api/types.ts`（重写）

移除所有 `Observable` 和 `MonoTypeOperatorFunction` 引用。`Agent` 接口改为 Promise + callback。

```typescript
export interface Agent {
  run(input: string, handlers?: RunHandlers): Promise<string>
  on(eventType: string, listener: (event: AgentEvent) => void): () => void
  cancel(): void
  pause(): Promise<void>
  resume(): void
  getState(): AgentLoopState | null
  destroy(): void
}

export interface RunHandlers {
  onToken?: (delta: string) => void
  onToolCall?: (call: ToolCallEvent) => void
  onToolResult?: (result: ToolResultEvent) => void
  onComplete?: (output: string) => void
  onError?: (error: AgentErrorEvent) => void
}
```

### 文件: `src/api/create-agent.ts`（重写，~400 行）

当前 997 行。移除所有 rxjs import、操作符管道构造、`Subscription` 管理。核心变为：

```typescript
export function createAgent(config: AgentConfig, services?: Partial<AgentContext>): Agent {
  // 1. 解析配置 → ResolvedConfig
  // 2. 构建 AgentContext (LLM, Tools, HookRegistry, Plugins)
  // 3. 创建 AgentLoop
  const loop = createAgentLoop(ctx, loopConfig)
  // 4. 注册插件 hooks 到 HookRegistry
  // 5. 返回 Agent 接口
  return {
    async run(input, handlers) {
      if (handlers) registerHandlers(loop, handlers)
      return loop.run(input)
    },
    on: loop.on,
    cancel: loop.cancel,
    pause: loop.pause,
    resume: loop.resume,
    getState: loop.getState,
    destroy: loop.destroy,
  }
}
```

### 文件: `src/api/agent-loop.ts`（重写，~100 行）

从 297 行精简到 ~100 行。移除 `AgentLoop` class、`Subject`、`AgentControl` 接口。

### 文件: `src/quickstart.ts`（适配，~150 行）

`Agent.generate()` 内部从 `firstValueFrom(agent.run$(...))` 改为 `await agent.run(...)`。

### 文件: `src/index.ts`（适配）

- 删除 operators 导出段（~60 行）
- 更新示例代码（移除 `.pipe()` / `.subscribe()`）
- 新增 hooks 导出

---

## Phase 5: 子系统适配 (Day 3)

### 适配器 (6 files)

`src/adapters/openai.ts`、`anthropic.ts`、`google.ts`、`ollama.ts`、`openai-http.ts`、`adapter-system.ts`

**变更**: `stream()` 返回类型从 `Observable<LLMChunk>` → `AsyncGenerator<LLMChunk>`。内部实现从 `new Observable(subscriber => {...})` 变为 `async function* stream(...) { for await (...) yield chunk }`。

```typescript
// 旧
stream(messages, options): Observable<LLMChunk> {
  return new Observable(subscriber => {
    const stream = await this.client.chat.completions.create({ stream: true, ... })
    for await (const chunk of stream) {
      subscriber.next({ text: chunk.choices[0]?.delta?.content })
    }
    subscriber.complete()
  })
}

// 新
async *stream(messages, options): AsyncGenerator<LLMChunk> {
  const stream = await this.client.chat.completions.create({ stream: true, ... })
  for await (const chunk of stream) {
    yield { text: chunk.choices[0]?.delta?.content }
  }
}
```

### A2A (3 files)

`src/a2a/client.ts`、`connection.ts`、`transport.ts`

**变更**: `onMessage(): Observable<A2AMessage>` → `onMessage(handler): () => void`。`onEvent(): Observable<ConnectionEvent>` → `onEvent(handler): () => void`。

```typescript
// 旧
onMessage(): Observable<A2AMessage> { return this.message$ }
connection.onEvent(): Observable<ConnectionEvent> { return this.event$ }

// 新 — 使用内部 EventEmitter
private emitter = new AgentEventEmitter()
onMessage(handler: (msg: A2AMessage) => void): () => void { return this.emitter.on('message', handler) }
onEvent(handler: (ev: ConnectionEvent) => void): () => void { return this.emitter.on('event', handler) }
```

### Workflow (3 files)

`src/workflow/workflow.ts`、`pipeline.ts`、`executor.ts`

**变更**: `run(input): Observable<WorkflowEvent>` → `run(input): Promise<WorkflowResult>` + `on(event, handler)`。

### Subagent (2 files)

`src/subagent/registry.ts`、`types.ts`

**变更**: `SubagentRegistry.run()` 从 `Observable<AgentEvent>` 改为 `Promise<string>` + emitter。

### MCP / Memory / Security / Skill (各 1-2 文件)

纯机械变更——`Observable<T>` → callback 或 AsyncGenerator。

---

## Phase 6: 测试 + 清理 (Day 4-5)

### 删除 (Day 4, 30 min)

```bash
rm -r src/operators/
rm -r src/loop/handlers/
rm tests/operators/*.test.ts
rm examples/02-operators.ts
```

### 测试迁移策略 (Day 4-5)

**核心测试** (`tests/loop/agent-loop.spec.ts`): 完全重写。Mock LLM adapter + Mock ToolRegistry，验证 agent loop 的行为而非事件流。

```typescript
// 旧测试 — 验证事件序列
const events: AgentEvent[] = []
loop.run$('hello').subscribe(e => events.push(e))
expect(events.map(e => e.type)).toEqual(['agent.start', 'llm.request', 'llm.response', 'agent.complete', 'done'])

// 新测试 — 验证行为
const result = await loop.run('hello')
expect(result).toContain('response')
```

**Handler 测试** (4 files): 删除——handler 已不存在，逻辑在循环内测试。

**API 测试** (`tests/api/create-agent.spec.ts`): 重写——验证 `agent.run()` 返回 Promise<string>，验证 `agent.on()` 和 `agent.cancel()`。

**Plugin 测试** (2 files): 重写——验证 RequestHook 修改 messages、ToolHook 阻断执行。

**子系统测试** (8 files): 适配——改 `Observable.subscribe()` → callback 注册。

**其他测试** (14 files): 机械适配——去掉 rxjs import，改 `pipe()` → `await`。

### 构建验证 (Day 5, 30 min)

```bash
npm run build     # tsc 无错误
npm test          # 全量测试通过
npm run lint      # eslint 无错误
```

---

## 工作量汇总

| Phase | 文件数 | 工时 |
|-------|--------|------|
| Phase 1: 基础设施 | 5 | 0.5 天 |
| Phase 2: 核心循环 | 4 (新) + 1 (重写) | 1.5 天 |
| Phase 3: 插件系统 | 6 (重写) | 0.5 天 |
| Phase 4: API 层 | 5 (重写+适配) | 1 天 |
| Phase 5: 子系统适配 | 20 (适配) | 1 天 |
| Phase 6: 测试+清理 | ~25 (测试) + 15 (删除) | 1.5 天 |
| **总计** | **~72 文件** | **6 天** |

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 循环重写引入新 bug | Phase 2 完成后立即写 agent-loop 测试，不等到 Phase 6 |
| 子系统适配遗漏 Observable | Phase 5 完成后 `grep -r "from 'rxjs'" src/` 必须返回空 |
| 测试覆盖率下降 | 345 tests → 目标保持 ≥300 tests |
| 回归 | 每个 Phase 后运行 `npm test`，不积累到 Phase 6 |
