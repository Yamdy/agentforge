# AgentForge 内核架构设计 — Imperative 循环 + Hook 切面

> AgentForge 采用命令式 `while(true) + await` 循环作为核心引擎，Hook 系统（RequestHook/ToolHook/LifecycleHook）作为横向切面，AgentEventEmitter 提供事件分发。
> 参考：ClaudeCode `src/query.ts` 循环模式 + OpenCode `Hooks` 接口设计

---

## 1. 架构原理

AgentForge 采用 imperative 控制流作为核心循环（调用 LLM → 执行工具 → 把结果喂回去），AgentEventEmitter 负责多订阅者事件分发和可观测性。

| 原则 | 描述 |
|------|------|
| **控制流自然** | `switch(event.type)` 已不存在，while 循环直接表达顺序逻辑 |
| **状态累积** | `AgentState` 在循环闭包中累积，串行工具可直接更新状态 |
| **精简抽象** | 错误恢复在 while 循环中直接实现，无需额外的事件类型 |

**核心结论**：Agent Loop 的本质是 imperative 控制流。AgentEventEmitter 提供可观测性外壳，Hook 提供前置/后置切面介入点。

---

## 2. 架构

### 2.1 层次划分

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (createAgent / run)                 │
│                    run(input, { onEvent, signal })           │
├─────────────────────────────────────────────────────────────┤
│              AgentEventEmitter (事件分发)                      │
│         on(type, callback) + AbortController 安全网           │
├─────────────────────────────────────────────────────────────┤
│                  Plugin 管道 (buildPluginPipeline)            │
│        Interceptor: await → 可修改/拦截/替换事件              │
│        Observer: fire-and-forget → 纯观察，永不阻塞           │
├─────────────────────────────────────────────────────────────┤
│           Hook 切面系统 (Imperative, OpenCode 模式)           │
│  在每个生命周期切割点，串行调用已注册的 hook 函数             │
│  签名: (input: Readonly, output: Mutable) => Promise<void>   │
├─────────────────────────────────────────────────────────────┤
│               核心循环 (async function while(true))           │
│  await llm.call() → 检测完成 → await tools.execute() → 循环  │
│  可变状态 (messages, tokens, step 等) 在闭包内管理            │
└─────────────────────────────────────────────────────────────┘
```

**关键设计决策**：
- **内层 imperative，外层 AgentEventEmitter**：核心循环用 `async/await` + `while(true)`，保持控制流自然；AgentEventEmitter 提供事件分发能力
- **Hook 在循环内，Plugin 通过 emitter 注册**：Hook 在每次 `await` 前后同步调用，能修改输入/输出；Observer Plugin 通过 `emitter.on()` 订阅事件
- **核心循环纯 imperative**：没有 `expand(step)`，没有 `StepContext`，没有 `switch(event.type)` 分发 40 种事件

### 2.2 核心循环伪代码

```typescript
function createAgentLoop(ctx: AgentContext, config: AgentLoopConfig): AgentLoop {
  return {
    run(input: string, options?: RunOptions): Promise<string> {
      return new Promise(async (resolve, reject) => {
      // ===== Imperative 可变状态 =====
      let messages: Message[] = buildInitialMessages(input, config)
      let step = 0
      let tokens = { prompt: 0, completion: 0 }
      let recoveryState = createRecoveryState()

      const emitter = ctx.emitter;

      // ===== Hook 执行器 =====
      const hooks = ctx.hookRegistry // 见 §3

      async function runHook(name: HookName, input: HookInput, output: HookOutput): Promise<HookResult> {
        const result: HookResult = { action: 'continue' }
        for (const hook of hooks.get(name)) {
          try {
            await hook(input, output)
          } catch (err) {
            // Hook 异常隔离 — 永远不击穿主循环
            ctx.logger?.warn(`Hook ${name} failed`, err)
          }
          // Hook 可以通过修改 output 来影响后续行为
          // 可以通过 throw 来中止（被 catch 捕获）
        }
        return result
      }

      async function loop(): Promise<void> {
        emit({ type: 'agent.start', timestamp: Date.now(), sessionId, input })

        // ===== Hook: session.start =====
        await runHook('session.start',
          { sessionId, agentName: ctx.agentName, input, model: config.model },
          { systemPrompt: config.systemPrompt }
        )

        while (true) {
          // 终止条件检查
          if (step >= config.maxSteps) {
            emit({ type: 'agent.complete', ... })
            emit({ type: 'done', reason: 'length' })
            break
          }
          if (subscriber.closed) break

          // ===== Hook: step.begin =====
          await runHook('step.begin',
            { sessionId, step, maxSteps: config.maxSteps, messageCount: messages.length },
            {}
          )

          // ─── 1. LLM 调用 ───
          const llmInput = { messages, tools: ctx.tools.getFunctionDefs(), model: config.model }
          const llmOutput = { params: {} as LLMOptions }

          await runHook('llm.request.before', llmInput, llmOutput)
          // Hook 可以修改 messages（如注入上下文）、修改 params（如覆盖 temperature）

          emit({ type: 'llm.request', ... })

          let response: LLMResponse
          try {
            response = await ctx.llm.chat(messages, llmOutput.params)
            tokens.prompt += response.usage?.promptTokens ?? 0
            tokens.completion += response.usage?.completionTokens ?? 0
          } catch (error) {
            // ─── 错误恢复 ───
            const errOutput = { recovery: undefined as RecoveryStrategy | undefined }
            await runHook('llm.response.error',
              { sessionId, error, recoveryState, model: config.model },
              errOutput
            )

            const strategy = errOutput.recovery ?? analyzeLLMError(error)
            if (strategy === 'escalate_output_tokens' && recoveryState.outputTokenEscalationCount < 1) {
              recoveryState.outputTokenEscalationCount++
              llmOutput.params.maxTokens = 64000
              continue  // 重试
            }
            if (strategy === 'switch_fallback_model' && config.fallbackModel && recoveryState.fallbackSwitchCount < 1) {
              recoveryState.fallbackSwitchCount++
              // config.model 切换到 fallback
              continue  // 重试
            }
            // 不可恢复
            emit({ type: 'agent.error', ... })
            emit({ type: 'done', reason: 'error' })
            break
          }

          // ===== Hook: llm.response.after =====
          const respOutput = { messages: [...messages] }
          await runHook('llm.response.after',
            { sessionId, response, step, usage: response.usage },
            respOutput
          )

          emit({ type: 'llm.response', ...response })

          // ─── 2. 完成检测 + Token 预算 ───
          if (response.finishReason === 'stop' || !response.toolCalls?.length) {
            // Token budget check
            const budgetDecision = checkTokenBudget(recoveryState.budgetTracker, config.tokenBudget ?? 200_000, tokens)
            if (budgetDecision === 'continue') {
              messages.push({ role: 'user', content: budgetDecision.nudgeMessage })
              continue
            }

            // Stop hooks
            await runHook('session.end',
              { sessionId, reason: 'completed', steps: step, tokens },
              {}
            )
            emit({ type: 'agent.complete', output: response.content, steps: step })
            emit({ type: 'done', reason: 'stop' })
            break
          }

          // ─── 3. 工具执行 ───
          const batches = partitionToolCalls(response.toolCalls, ctx.tools)

          for (const batch of batches) {
            if (subscriber.closed) break

            if (batch.isConcurrencySafe && batch.calls.length > 1) {
              // 并行批
              const results = await Promise.all(
                batch.calls.map(async tc => {
                  const toolOutput = { args: tc.args, permission: 'allow' as const }
                  await runHook('tool.execute.before',
                    { sessionId, toolName: tc.name, callId: tc.id, args: tc.args },
                    toolOutput
                  )
                  if (toolOutput.permission === 'deny') {
                    return { tc, result: 'Permission denied', isError: true }
                  }

                  try {
                    const result = await ctx.tools.execute(tc.name, toolOutput.args)
                    const afterOutput = { result, metadata: {} as Record<string, unknown> }
                    await runHook('tool.execute.after',
                      { sessionId, toolName: tc.name, callId: tc.id, args: toolOutput.args },
                      afterOutput
                    )
                    return { tc, result: afterOutput.result, isError: false }
                  } catch (err) {
                    const errOutput = { retry: false }
                    await runHook('tool.execute.error',
                      { sessionId, toolName: tc.name, callId: tc.id, error: err },
                      errOutput
                    )
                    return { tc, result: String(err), isError: true }
                  }
                })
              )

              for (const r of results) {
                emit({ type: 'tool.execute', toolCallId: r.tc.id, toolName: r.tc.name, ... })
                emit({ type: 'tool.result', toolCallId: r.tc.id, result: r.result, isError: r.isError, ... })
              }
            } else {
              // 串行批
              for (const tc of batch.calls) {
                if (subscriber.closed) break
                // ... 同上，逐个执行
              }
            }
          }

          // ─── 4. 拼装下一轮消息 ───
          step++

          // ===== Hook: step.end =====
          await runHook('step.end',
            { sessionId, step, messages, tokens },
            {}
          )

          // Hook 可能触发自动压缩
          if (shouldCompact(messages, tokens)) {
            const compactOutput = { messages }
            await runHook('compaction.before',
              { sessionId, messages, tokenCount: tokens.prompt + tokens.completion },
              compactOutput
            )
            if (ctx.compactionManager) {
              const compacted = await ctx.compactionManager.compact({ messages, ... })
              messages = compacted.messages
            }
            await runHook('compaction.after',
              { sessionId, messages, tokenCount: estimateTokens(messages) },
              {}
            )
          }

          // 继续循环
        }
      }

      loop()
        .catch(error => {
          ctx.logger?.error('Agent loop crashed', error)
          emitter.emit({ type: 'agent.error', error: serializeError(error), ... })
          emitter.emit({ type: 'done', reason: 'error' })
        })
        .finally(() => {
          isRunning = false;
          resolve(finalOutput);
        })
    });
```

---

## 3. Hook 系统设计

### 3.1 Hook 签名（借鉴 OpenCode）

```typescript
// src/core/hooks.ts (新文件)

/**
 * Hook 函数签名：接收只读上下文 (input) 和可变输出 (output)。
 * Hook 通过修改 output 来影响后续流程，通过 throw 来中止。
 *
 * 参考：OpenCode Hooks 接口 — (input, output) => Promise<void>
 */
export type HookFn<Input, Output> = (input: Readonly<Input>, output: Output) => Promise<void>

/**
 * Hook 名称枚举 — 所有生命周期切割点
 */
export const HookNames = [
  'session.start',        // Agent 启动
  'session.end',          // Agent 终止（正常/异常）
  'step.begin',           // 每轮循环开始
  'step.end',             // 每轮循环结束
  'llm.request.before',   // LLM 调用前（可修改 messages、params）
  'llm.response.after',   // LLM 响应后（可观察/审计）
  'llm.response.error',   // LLM 调用失败（可决定恢复策略）
  'tool.execute.before',  // 工具执行前（可修改 args、拒绝执行）
  'tool.execute.after',   // 工具执行后（可修改 result）
  'tool.execute.error',   // 工具执行失败（可决定重试）
  'compaction.before',    // 上下文压缩前（可修改压缩参数）
  'compaction.after',     // 上下文压缩后
] as const

export type HookName = (typeof HookNames)[number]
```

### 3.2 每个 Hook 的输入/输出类型

```typescript
// src/core/hooks.ts (续)

/** session.start — Agent 启动时 */
export interface SessionStartInput {
  sessionId: string
  agentName: string
  input: string
  model: ModelConfig
}
export interface SessionStartOutput {
  systemPrompt?: string       // Hook 可以修改 system prompt
}

/** llm.request.before — LLM 调用前 */
export interface LLMRequestBeforeInput {
  sessionId: string
  step: number
  messages: Message[]
  model: ModelConfig
}
export interface LLMRequestBeforeOutput {
  messages: Message[]         // Hook 可以增删改消息
  params: LLMOptions          // Hook 可以覆盖 LLM 参数
}

/** llm.response.after — LLM 响应后 */
export interface LLMResponseAfterInput {
  sessionId: string
  step: number
  response: LLMResponse
  usage?: LLMUsage
}
export interface LLMResponseAfterOutput {
  /** 审计/日志字段 — 纯输出，不修改主流程 */
}

/** llm.response.error — LLM 调用失败 */
export interface LLMResponseErrorInput {
  sessionId: string
  step: number
  error: Error
  recoveryState: RecoveryState
  model: ModelConfig
}
export interface LLMResponseErrorOutput {
  recovery?: RecoveryStrategy  // Hook 可以建议恢复策略
}

/** tool.execute.before — 工具执行前 */
export interface ToolExecuteBeforeInput {
  sessionId: string
  toolName: string
  callId: string
  args: Record<string, unknown>
}
export interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>   // Hook 可以修改参数
  permission: 'allow' | 'deny'    // Hook 可以拒绝执行
}

/** tool.execute.after — 工具执行后 */
export interface ToolExecuteAfterInput {
  sessionId: string
  toolName: string
  callId: string
  args: Record<string, unknown>
}
export interface ToolExecuteAfterOutput {
  result: string                      // Hook 可以修改结果
  metadata: Record<string, unknown>   // Hook 可以附加元数据
}

/** tool.execute.error — 工具执行失败 */
export interface ToolExecuteErrorInput {
  sessionId: string
  toolName: string
  callId: string
  error: unknown
}
export interface ToolExecuteErrorOutput {
  retry: boolean    // Hook 可以决定是否重试
}

/** compaction.before — 上下文压缩前 */
export interface CompactionBeforeInput {
  sessionId: string
  messages: Message[]
  tokenCount: number
}
export interface CompactionBeforeOutput {
  messages: Message[]   // Hook 可以在压缩前修改消息
}

/** compaction.after — 上下文压缩后 */
export interface CompactionAfterInput {
  sessionId: string
  messages: Message[]
  tokenCount: number
}

/** session.end — Agent 终止 */
export interface SessionEndInput {
  sessionId: string
  reason: 'completed' | 'error' | 'cancelled' | 'length'
  steps: number
  tokens: { prompt: number; completion: number }
}

/** step.begin / step.end */
export interface StepBeginInput {
  sessionId: string
  step: number
  maxSteps: number
  messageCount: number
}
export interface StepEndInput {
  sessionId: string
  step: number
  messages: Message[]
  tokens: { prompt: number; completion: number }
}
```

### 3.3 Hook 注册与执行

```typescript
// src/core/hooks.ts (续)

export class HookRegistry {
  private hooks = new Map<HookName, HookFn<any, any>[]>()

  /**
   * 注册一个 hook 到指定的生命周期切割点。
   *
   * @param name - Hook 名称
   * @param fn - Hook 函数
   * @param priority - 优先级（越小越先执行），默认 100
   */
  register<Input, Output>(name: HookName, fn: HookFn<Input, Output>, priority: number = 100): void {
    const entry = { fn, priority }
    const list = this.hooks.get(name) ?? []
    list.push(entry)
    list.sort((a, b) => a.priority - b.priority)
    this.hooks.set(name, list)
  }

  /** 获取指定切割点的所有 hook（按 priority 排序） */
  get(name: HookName): HookFn<any, any>[] {
    return (this.hooks.get(name) ?? []).map(e => e.fn)
  }

  /** 注销 hook（按函数引用匹配） */
  unregister(name: HookName, fn: HookFn<any, any>): void {
    const list = this.hooks.get(name)
    if (!list) return
    this.hooks.set(name, list.filter(e => e.fn !== fn))
  }
}
```

### 3.4 使用示例

```typescript
// 审计日志 hook — 通过 session.end 切面记录
ctx.hookRegistry.register('session.end', async (input: SessionEndInput, _output) => {
  await auditLog.append({
    sessionId: input.sessionId,
    duration: Date.now() - startTime,
    steps: input.steps,
    tokens: input.tokens,
  })
})

// 权限控制 hook — 通过 tool.execute.before 切面拒绝危险命令
ctx.hookRegistry.register('tool.execute.before', async (input, output) => {
  if (input.toolName === 'bash' && isDangerousCommand(input.args)) {
    output.permission = 'deny'
  }
})

// 上下文注入 hook — 通过 llm.request.before 自动附加项目规范
ctx.hookRegistry.register('llm.request.before', async (input, output) => {
  const projectRules = await loadProjectRules()
  output.messages.unshift({ role: 'system', content: projectRules })
})

// 成本控制 hook — 通过 llm.response.after 监控 token 消耗
ctx.hookRegistry.register('llm.response.after', async (input, _output) => {
  if (input.usage) {
    await costTracker.record(input.sessionId, input.usage)
  }
})
```

---

## 4. 事件精简

当前 40+ 事件类型中，**只有约 10 个有外部消费者**。精简后：

### 保留的事件（有外部消费者）

| 事件 | 消费者 | 用途 |
|------|--------|------|
| `agent.start` | UI, Logger, Metrics | Agent 启动信号 |
| `agent.complete` | UI, CLI | 完成通知 + 输出内容 |
| `agent.error` | UI, Logger, operator `retryOnEventType` | 错误通知 + 重试触发 |
| `done` | operator `timeoutOnEventType`, 所有订阅者 | 流终止信号 |
| `llm.response` | Plugin (observer) | LLM 输出观察 |
| `llm.stream.text` | UI (流式显示) | 实时文本增量 |
| `tool.result` | Plugin (observer), Logger | 工具结果通知 |
| `subagent.start` | Logger, parent agent | 子代理启动通知 |
| `subagent.complete` | Logger, parent agent | 子代理完成通知 |
| `workflow.complete` | Logger | 工作流完成通知 |

### 删除的事件（无消费者或已内联到循环）

`llm.request`、`llm.stream.start`、`llm.stream.tool_call`、`llm.stream.end`、`llm.error`、`llm.output.invalid`、`tool.call`、`tool.execute`、`tool.error`、`tool.batch`、`tool.batch.start`、`tool.batch.complete`、`hitl.ask`、`hitl.answer`、`state.change`、`checkpoint`、`cancel`、`mcp.*`、`workflow.*`（多数）、`compaction.*`、`permission.*`、`decision.trace`

**总数从 40+ 降到 15 以内。**

---

## 5. 现有设计文档 (21-23) 在新架构下的简化

### 21-TOKEN-BUDGET

不再需要 `TokenBudgetState` Zod schema 和 `AgentState` 扩展。变成循环内的 15 行：

```typescript
// 在 while(true) 循环内，if (!response.toolCalls?.length) 分支中
const budget = config.tokenBudget ?? 200_000
const pct = (tokens.prompt + tokens.completion) / budget
const diminishing = recoveryState.budgetContinuations >= 3
  && (tokens.prompt + tokens.completion - recoveryState.lastCheckTokens) < 500

if (!diminishing && pct < 0.9) {
  recoveryState.budgetContinuations++
  recoveryState.lastCheckTokens = tokens.prompt + tokens.completion
  messages.push({ role: 'user', content: `Token budget: ${Math.round(pct*100)}% used. Continue if needed.` })
  continue
}
// else: 正常完成
```

### 22-ERROR-RECOVERY

不再需要 `RecoveryState` Zod schema、`analyzeLLMError` 独立文件、`callLLMWithOptions` 函数。变成循环内 catch 块的 25 行：

```typescript
} catch (error) {
  if (isOutputTokenLimit(error) && recoveryState.outputEscalation < 1) {
    recoveryState.outputEscalation++
    llmOptions.maxTokens = 64000
    continue  // 重试
  }
  if (isOverloaded(error) && config.fallbackModel && recoveryState.fallbackSwitch < 1) {
    recoveryState.fallbackSwitch++
    config.model = config.fallbackModel  // 切换模型
    continue  // 重试
  }
  if (isContextOverflow(error) && recoveryState.compactionRetry < 1) {
    recoveryState.compactionRetry++
    messages = await compactMessages(messages)  // 压缩后重试
    continue
  }
  // 不可恢复
  emit({ type: 'agent.error', error: serializeError(error) })
  emit({ type: 'done', reason: 'error' })
  break
}
```

### 23-TOOL-CONCURRENCY

不再需要手动构造器。变成循环内的 imperative 分批执行（§2.2 中已内联）。

---

## 6. Plugin 系统适配

Plugin 系统保持现有 `InterceptorPlugin` / `ObserverPlugin` 接口不变，但工作方式变为"注册到 HookRegistry + 订阅事件"：

```typescript
// plugins/pipeline.ts — 实现

export function buildPluginPipeline(
  plugins: readonly Plugin[],
  hookRegistry: HookRegistry,
  emitter: AgentEventEmitter,
): () => void {
  // 1. 注册插件的 hook 到 HookRegistry
  for (const plugin of plugins) {
    if (plugin.type === 'interceptor') {
      hookRegistry.register(plugin.hookName, plugin.intercept)
    }
  }

  // 2. 观察器通过 emitter 订阅
  const observers = plugins.filter(p => p.type === 'observer').filter(p => p.enabled)
  const unsubs: Array<() => void> = []
  for (const obs of observers) {
    unsubs.push(emitter.onAny(event => {
      try { obs.observe(event) } catch { /* 隔离 */ }
    }))
  }
  return () => unsubs.forEach(fn => fn())
}
```

Plugin 实现改用 Hook 注册 + emitter 观察。Plugin 接口新增 `getHooks(): HookRegistration[]` 方法。

---

## 7. 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/core/hooks.ts` | **新建** | HookRegistry、HookFn、所有 Hook 输入/输出类型 |
| `src/loop/agent-loop.ts` | **重写** | expand → while(true) imperative 循环 |
| `src/loop/handlers/*` | **删除** | 逻辑内联到循环体 |
| `src/core/events.ts` | **精简** | 40+ → ~15 事件类型 |
| `src/core/state.ts` | **精简** | 移除 StepContext、BatchContext 等中间类型 |
| `src/plugins/plugin.ts` | 修改 | Plugin 接口新增 `getHooks()` |
| `src/plugins/pipeline.ts` | 修改 | 适配 HookRegistry |
| `src/operators/*` | 不变 | 仅改事件类型引用 |
| `src/api/create-agent.ts` | 不变 | 接口签名不变 |
| `src/quota/*`、`src/memory/*`、`src/skill/*` | 不变 | DI 注入，不感知循环结构 |
| `tests/loop/*` | **重写** | 适配新循环 |

---

## 8. 与 ClaudeCode / OpenCode 的对比

| 维度 | ClaudeCode | OpenCode | AgentForge 新设计 |
|------|-----------|----------|------------------|
| 核心循环 | AsyncGenerator while(true) | 未暴露 | Async function while(true) with emitter |
| Hook 机制 | 无（内联） | `(input, output) => Promise<void>` 16 个切面 | 同 OpenCode 模式，12 个切面 |
| 可观测性 | React store 直读 | Effect Stream | AgentEventEmitter + Hook |
| 操作符 | 无 | 无 | `on(event, callback)` + AbortSignal.timeout() |
| 类型安全 | strict: false | Effect-TS type-safe | Zod + TypeScript strict: true |
| 插件模型 | feature flag + DCE | npm plugin + Hook | Hook + emitter observer |
