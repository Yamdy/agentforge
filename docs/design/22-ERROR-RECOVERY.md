# 分级错误恢复 — 设计文档

> 状态：待评审
> 阻塞等级：P1 — 当前任何 LLM 错误都直接终止 Agent，缺少分级恢复能力
> 参考实现：ClaudeCode `src/query.ts` 错误恢复段（~250 行）
> 预估工作量：1 天

---

## 1. 问题

当前 AgentForge 对 LLM 错误采用**一刀切终止**策略：

```typescript
// src/loop/handlers/llm.ts — callLLMInner() 当前行为
catchError(error => {
  // 任何错误 → agent.error + done，Agent 立即终止
  const errorEvent = { type: 'agent.error', error: serializeError(error) }
  const doneEv = { type: 'done', reason: 'error' }
  return from([errorEvent, doneEv])
})
```

这意味着即使是**可恢复的错误**（如 token 超限、模型过载），Agent 也会立即终止，用户需要手动重试。

### ClaudeCode 的分级恢复

ClaudeCode 对 4 类可恢复错误分别设计了恢复策略：

| 错误类型 | 症状 | ClaudeCode 恢复策略 | 次数限制 |
|---------|------|-------------------|---------|
| `max_output_tokens` | API 返回 `stop_reason: max_tokens` | 1) 升级到 64K output；2) 注入恢复消息（3 次） | 1 次升级 + 3 次恢复 |
| `prompt_too_long` | API 返回 413 / is_error | 1) Collapse drain；2) Reactive compact | 各 1 次 |
| `model_overloaded` | API 返回 529 / FallbackTriggeredError | 切换到 fallback 模型 | 1 次 |
| `streaming_fallback` | 流中断，内部触发 fallback | 清理 orphan messages，用 fallback 模型重试 | 1 次 |

---

## 2. 设计

### 2.1 错误分类体系

以现有 `ErrorCategory` 为基础扩展：

```typescript
// src/core/interfaces.ts — 扩展 ErrorCategory（新增以 🔴 标记）

export type ErrorCategory =
  | 'llm_timeout'
  | 'llm_rate_limit'
  | 'llm_server_error'
  | 'llm_invalid_response'
  | 'llm_token_limit'        // 🔴 新增: max_output_tokens / context_length_exceeded
  | 'llm_overloaded'         // 🔴 新增: 模型过载/降级
  | 'tool_execution'
  | 'tool_validation'
  | 'tool_not_found'
  | 'schema_violation'
  | 'context_corrupted'
  | 'permission_denied'
  | 'checkpoint_failed'
  | 'unknown'
```

### 2.2 错误分析器

新增一个纯函数文件，将原始错误映射到分类和恢复策略：

```typescript
// src/loop/error-analyzer.ts (新文件)

/**
 * 可恢复错误的分析结果。
 */
export interface ErrorAnalysis {
  /** 错误分类 */
  category: ErrorCategory
  /** 是否可恢复 */
  recoverable: boolean
  /** 恢复策略（如果可恢复） */
  recovery?: RecoveryStrategy
  /** 用户可见的错误消息 */
  userMessage: string
}

/**
 * 恢复策略枚举
 */
export type RecoveryStrategy =
  | 'escalate_output_tokens'    // 升级 maxOutputTokens
  | 'inject_recovery_message'   // 注入恢复提示消息
  | 'switch_fallback_model'     // 切换到 fallback 模型
  | 'retry_with_truncation'     // 截断消息后重试（自动压缩）
  | 'trigger_compaction'        // 触发上下文压缩
  | 'clean_orphan_and_retry'    // 清理孤儿消息后重试

/**
 * 恢复状态 — 跨循环迭代持久的计数器。
 * 防止无限恢复循环。
 */
export interface RecoveryState {
  /** 最大 output token 升级次数 */
  outputTokenEscalationCount: number
  /** 恢复消息注入次数 */
  recoveryMessageCount: number
  /** fallback 模型切换次数 */
  fallbackSwitchCount: number
  /** 压缩后重试次数 */
  compactionRetryCount: number
}

/** 恢复次数上限 */
export const RECOVERY_LIMITS = {
  outputTokenEscalation: 1,    // 升级 output tokens 最多 1 次
  recoveryMessage: 3,          // 注入恢复消息最多 3 次
  fallbackSwitch: 1,           // 切换 fallback 模型最多 1 次
  compactionRetry: 1,          // 触发压缩最多 1 次
} as const

/** 升级后的 maxOutputTokens (ClaudeCode 使用 64000) */
export const ESCALATED_MAX_OUTPUT_TOKENS = 64000

/**
 * 分析 LLM 错误，返回分类和恢复策略。
 *
 * 基于 ClaudeCode 的错误识别模式：
 * - max_output_tokens: stop_reason === 'length' 或 finishReason === 'length'
 * - prompt_too_long: HTTP 413 或错误消息包含 "prompt is too long"/"tokens exceed"
 * - model_overloaded: HTTP 529 或错误消息包含 "overloaded"/"capacity"
 */
export function analyzeLLMError(
  error: Error,
  finishReason?: string,
  responseStatus?: number,
): ErrorAnalysis {
  const message = error.message.toLowerCase()

  // 1. max_output_tokens — 可在 llm.response 中检测
  if (finishReason === 'length') {
    return {
      category: 'llm_token_limit',
      recoverable: true,
      recovery: 'escalate_output_tokens',
      userMessage: 'Output token limit reached. Attempting recovery with increased token limit...',
    }
  }

  // 2. prompt_too_long — API 返回 413
  if (responseStatus === 413 || message.includes('prompt is too long') || message.includes('tokens exceed')) {
    return {
      category: 'llm_token_limit',
      recoverable: true,
      recovery: 'trigger_compaction',
      userMessage: 'Context window exceeded. Triggering automatic compaction...',
    }
  }

  // 3. model_overloaded — API 返回 529
  if (responseStatus === 529 || message.includes('overloaded') || message.includes('capacity')) {
    return {
      category: 'llm_overloaded',
      recoverable: true,
      recovery: 'switch_fallback_model',
      userMessage: 'Model is currently overloaded. Switching to fallback model...',
    }
  }

  // 4. rate_limit — 可重试，但不自动恢复（等待是最佳策略）
  if (responseStatus === 429 || message.includes('rate limit')) {
    return {
      category: 'llm_rate_limit',
      recoverable: false, // 不自动恢复 — 等待冷却
      userMessage: `Rate limit exceeded: ${error.message}`,
    }
  }

  // 5. server_error — 不可恢复（非暂时性）
  if (responseStatus && responseStatus >= 500) {
    return {
      category: 'llm_server_error',
      recoverable: false,
      userMessage: `LLM server error: ${error.message}`,
    }
  }

  // 默认 — 不可恢复
  return {
    category: 'unknown',
    recoverable: false,
    userMessage: error.message,
  }
}
```

### 2.3 AgentState 扩展

```typescript
// src/core/state.ts — AgentStateSchema 新增字段

export const AgentStateSchema = z.object({
  // ... 现有字段 ...

  /**
   * Error recovery state — persists across loop iterations.
   * Prevents infinite recovery loops by tracking retry counts.
   */
  recoveryState: z.object({
    outputTokenEscalationCount: z.number(),
    recoveryMessageCount: z.number(),
    fallbackSwitchCount: z.number(),
    compactionRetryCount: z.number(),
  }).optional(),
})
```

### 2.4 核心集成点

**关键设计原则：** 错误恢复不改变 RxJS 事件流结构。恢复逻辑通过 `expand()` 递归自然实现 — 恢复就是发射一个新事件让循环继续。

#### 集成点 1: llm.response 中的 `finishReason === 'length'`

```typescript
// src/loop/handlers/llm.ts — handleLLMResponse() 新增检测

export function handleLLMResponse(
  deps: HandlerDeps,
  state: AgentState,
  event: Extract<AgentEvent, { type: 'llm.response' }>,
  repairAttempt?: number,
): Observable<StepContext> {
  // ... 现有代码 ...

  // 🔴 新增：检测 max_output_tokens 并触发升级恢复
  if (finishReason === 'length') {
    const recovery = state.recoveryState ?? createRecoveryState()
    const analysis = analyzeLLMError(new Error('max_output_tokens'), 'length')

    if (analysis.recoverable && analysis.recovery === 'escalate_output_tokens') {
      // 策略 1: 升级 output tokens（只做一次）
      if (recovery.outputTokenEscalationCount < RECOVERY_LIMITS.outputTokenEscalation) {
        const escalatedLLMOptions: LLMOptions = {
          maxTokens: ESCALATED_MAX_OUTPUT_TOKENS,
        }
        const newState: AgentState = {
          ...state,
          recoveryState: {
            ...recovery,
            outputTokenEscalationCount: recovery.outputTokenEscalationCount + 1,
          },
        }
        // 用升级后的选项重新调用 LLM（同一批消息）
        return callLLMWithOptions(deps, newState, escalatedLLMOptions)
      }

      // 策略 2: 注入恢复消息（最多 3 次）
      if (recovery.recoveryMessageCount < RECOVERY_LIMITS.recoveryMessage) {
        const recoveryMessage: Message = {
          role: 'user',
          content: [
            'Output token limit hit. Resume directly — no apology, no recap of what you were doing.',
            'Pick up mid-thought if that is where the cut happened.',
            'Break remaining work into smaller pieces.',
          ].join(' '),
        }
        const newState: AgentState = {
          ...state,
          messages: [...state.messages, recoveryMessage],
          recoveryState: {
            ...recovery,
            recoveryMessageCount: recovery.recoveryMessageCount + 1,
          },
        }
        const requestEvent: AgentEvent = {
          type: 'llm.request',
          timestamp: Date.now(),
          sessionId,
          messages: newState.messages,
          model: config.model,
          tools: ctx.tools.list(),
        }
        return concat(
          emitSystemMessage(deps, analysis.userMessage, 'warning'),
          of({ event: requestEvent, state: newState } as StepContext),
        )
      }
    }

    // 恢复耗尽 — 正常完成（输出不完整但尽力了）
    ctx.logger?.warn('max_output_tokens recovery exhausted')
    // fall through to normal completion
  }

  // ... 原有完成逻辑 ...
}
```

#### 集成点 2: callLLMInner() 的 catchError

```typescript
// src/loop/handlers/llm.ts — callLLMInner() catchError 修改

catchError(error => {
  const err = error instanceof Error ? error : new Error(String(error))
  const analysis = analyzeLLMError(err, undefined, (error as any).status)

  // 🔴 新增：可恢复错误 — 不终止，尝试恢复
  if (analysis.recoverable && analysis.recovery) {
    ctx.logger?.warn(`LLM error (recoverable): ${analysis.category}`, err)

    switch (analysis.recovery) {
      case 'switch_fallback_model':
        // 切换到 fallback 模型（需要 AgentLoopConfig 配置）
        if (config.fallbackModel && state.recoveryState) {
          const newRecovery = { ...state.recoveryState }
          if (newRecovery.fallbackSwitchCount < RECOVERY_LIMITS.fallbackSwitch) {
            newRecovery.fallbackSwitchCount++
            const newState = { ...state, recoveryState: newRecovery }
            // 切换模型后重试
            const switchedConfig = { ...config, model: config.fallbackModel }
            // 注意：需要修改 callLLMInner 以支持 override model
            return callLLMWithFallbackModel(deps, newState, switchedConfig)
          }
        }
        break

      case 'trigger_compaction':
        // 触发自动压缩后重试
        if (ctx.compactionManager && state.recoveryState) {
          const newRecovery = { ...state.recoveryState }
          if (newRecovery.compactionRetryCount < RECOVERY_LIMITS.compactionRetry) {
            newRecovery.compactionRetryCount++
            const compactionCtx: CompactionContext = {
              sessionId,
              messages: state.messages,
              maxTokens: state.contextManagement?.totalTokens ?? 8000,
              currentTokenEstimate: estimateTokenCount(state.messages),
            }
            return from(ctx.compactionManager.compact(compactionCtx)).pipe(
              mergeMap(result => {
                const compactedState: AgentState = {
                  ...state,
                  messages: result.messages as Message[],
                  recoveryState: newRecovery,
                }
                // 发射系统消息告知用户
                return concat(
                  emitSystemMessage(deps, analysis.userMessage, 'warning'),
                  config.streaming
                    ? callLLMStreaming(deps, compactedState)
                    : callLLM(deps, compactedState),
                )
              }),
            )
          }
        }
        break
    }
  }

  // 🔴 原有逻辑：不可恢复 → agent.error + done
  const errorEvent: AgentEvent = {
    type: 'agent.error',
    timestamp: Date.now(),
    sessionId,
    error: serializeError(error),
    step: state.step,
  }
  const doneEv: AgentEvent = { type: 'done', timestamp: Date.now(), sessionId, reason: 'error' }
  return from([
    { event: errorEvent, state },
    { event: doneEv, state },
  ] as StepContext[])
})
```

### 2.5 辅助函数

```typescript
// src/loop/handlers/llm.ts 新增

/**
 * 发射系统通知消息（warning/info 级别，用于通知观察者恢复状态）。
 *
 * 设计说明：
 * - 此消息不存储到 AgentState.messages（不是对话内容，不应发送给 LLM）
 * - 此消息仅通过事件流通知 UI/日志等观察者
 * - 使用专用的 `system.notification` 事件类型而非 `llm.response` 的 `as` 强转
 *   （`llm.response` 的 Zod schema 要求完整的 usage、model 等字段，cast 会导致运行时校验失败）
 *
 * 前置条件：需要在 events.ts 中新增 `system.notification` 事件类型：
 * ```typescript
 * // src/core/events.ts — 新增
 * export const SystemNotificationEventSchema = z.object({
 *   type: z.literal('system.notification'),
 *   timestamp: z.number(),
 *   sessionId: z.string(),
 *   level: z.enum(['info', 'warning']),
 *   content: z.string(),
 * })
 * ```
 * 然后在 agent-loop.ts 的 step() switch 中的 default 分支被 EMPTY 忽略（纯可观测事件）。
 */
function emitSystemMessage(
  deps: HandlerDeps,
  content: string,
  level: 'info' | 'warning',
): Observable<StepContext> {
  const notifEvent: AgentEvent = {
    type: 'system.notification',
    timestamp: Date.now(),
    sessionId: deps.sessionId,
    level,
    content: `[${level.toUpperCase()}] ${content}`,
  } as AgentEvent
  return of({ event: notifEvent, state: deps.state } as StepContext)
}

/** 创建初始恢复状态 */
export function createRecoveryState(): RecoveryState {
  return {
    outputTokenEscalationCount: 0,
    recoveryMessageCount: 0,
    fallbackSwitchCount: 0,
    compactionRetryCount: 0,
  }
}

// ============================================================
// 恢复辅助函数：模型切换 + Output Token 升级
// ============================================================

/**
 * 使用升级后的 LLM 选项重新调用 LLM（用于 output token 升级恢复）。
 *
 * 与 callLLM / callLLMStreaming 的区别：
 * - 接收额外的 LLMOptions 参数，用于覆盖 maxTokens 等选项
 * - 仍然走完整的 quota/circuit-breaker/rate-limiter 检查
 *
 * @param deps - Handler 依赖
 * @param state - 当前 AgentState（已更新 recoveryState 计数器）
 * @param options - 升级后的 LLM 选项（如 { maxTokens: 64000 }）
 */
function callLLMWithOptions(
  deps: HandlerDeps,
  state: AgentState,
  options: LLMOptions,
  repairAttempt: number = 0,
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps
  const mergedConfig = { ...config }
  const toolDefs = ctx.tools
    .list()
    .map(name => ctx.tools.get(name)!)
    .filter((t): t is ToolDefinition<z.ZodTypeAny> => t !== undefined)
  const messages = buildMessages(state.messages, ctx.promptBuilder, config.systemPrompt, toolDefs)
  const llmOptions: LLMOptions = { ...options, tools: ctx.tools.getFunctionDefs() }

  if (config.streaming) {
    return new Observable<StepContext>(subscriber => {
      subscriber.next({
        event: { type: 'llm.stream.start', timestamp: Date.now(), sessionId },
        state,
      })
      let accumulatedContent = ''
      const sub = ctx.llm.stream(messages, llmOptions).subscribe({
        next(chunk) {
          if (chunk.text) {
            accumulatedContent += chunk.text
            subscriber.next({
              event: { type: 'llm.stream.text', timestamp: Date.now(), sessionId, delta: chunk.text },
              state,
            })
          }
        },
        error(error) {
          const err = error instanceof Error ? error : new Error(String(error))
          subscriber.next({
            event: { type: 'agent.error', timestamp: Date.now(), sessionId, error: serializeError(error), step: state.step },
            state,
          })
          subscriber.next({
            event: { type: 'done', timestamp: Date.now(), sessionId, reason: 'error' },
            state,
          })
          subscriber.complete()
        },
        complete() {
          subscriber.next({
            event: { type: 'llm.stream.end', timestamp: Date.now(), sessionId },
            state,
          })
          subscriber.next({
            event: {
              type: 'llm.response',
              timestamp: Date.now(),
              sessionId,
              content: accumulatedContent,
              finishReason: 'stop',
            },
            state,
            repairAttempt,
          })
          subscriber.complete()
        },
      })
      return () => sub.unsubscribe()
    })
  }

  return from(ctx.llm.chat(messages, llmOptions)).pipe(
    mergeMap(response => {
      const respEvent: AgentEvent = {
        type: 'llm.response',
        timestamp: Date.now(),
        sessionId,
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: response.usage,
      }
      return of({ event: respEvent, state, repairAttempt } as StepContext)
    }),
  )
}

/**
 * 使用 fallback 模型重新调用 LLM（用于模型过载恢复）。
 *
 * @param deps - Handler 依赖（内部 config.model 会被覆盖）
 * @param state - 当前 AgentState（已更新 recoveryState.fallbackSwitchCount）
 * @param fallbackConfig - fallback 模型配置（provider + model）
 */
function callLLMWithFallbackModel(
  deps: HandlerDeps,
  state: AgentState,
  fallbackConfig: ModelConfig,
  repairAttempt: number = 0,
): Observable<StepContext> {
  const { ctx, config, sessionId } = deps
  // 覆盖 deps.config.model 为 fallback 模型
  const fallbackDeps: HandlerDeps = {
    ...deps,
    config: { ...config, model: fallbackConfig },
  }
  return config.streaming
    ? callLLMStreaming(fallbackDeps, state, repairAttempt)
    : callLLM(fallbackDeps, state, repairAttempt)
}
```

### 2.6 AgentLoopConfig 扩展

```typescript
// src/loop/agent-loop.ts — 新增字段

export interface AgentLoopConfig {
  // ... 现有字段 ...

  /**
   * Fallback model to use when the primary model is overloaded.
   * Example: if primary is 'claude-sonnet-4-5', fallback could be 'claude-haiku-4-5'.
   * When undefined, model overload errors are not recoverable.
   */
  fallbackModel?: ModelConfig

  /**
   * Maximum output tokens override for escalated recovery.
   * Default: 64000 (ClaudeCode's ESCALATED_MAX_TOKENS)
   */
  escalatedMaxOutputTokens?: number
}
```

### 2.7 恢复事件流示意

```
┌──────────────┐
│ LLM Error    │
└──────┬───────┘
       │
┌──────▼──────────────────────────────┐
│  analyzeLLMError(error)             │
│  → category + recovery strategy     │
└──────┬──────────────────────────────┘
       │
       ├─ recoverable=false ──→ agent.error + done (terminate)
       │
       ├─ escalation ──→ 升级 maxOutputTokens → llm.request (retry)
       │
       ├─ recovery_msg ──→ 注入恢复消息 + llm.request (retry)
       │                   ↓ (3 次后耗尽 → terminate)
       │
       ├─ fallback ──→ 切换模型 + llm.request (retry)
       │              ↓ (1 次后耗尽 → terminate)
       │
       └─ compaction ──→ 压缩上下文 + llm.request (retry)
                        ↓ (1 次后耗尽 → terminate)
```

---

## 3. 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/loop/error-analyzer.ts` | **新建** | ErrorAnalysis、analyzeLLMError()、RecoveryState、常量 |
| `src/core/interfaces.ts` | 修改 | ErrorCategory 新增 llm_token_limit、llm_overloaded |
| `src/core/events.ts` | 修改 | 新增 `system.notification` 事件类型（Zod schema） |
| `src/core/state.ts` | 修改 | AgentStateSchema 新增 recoveryState |
| `src/loop/agent-loop.ts` | 修改 | AgentLoopConfig 新增 fallbackModel、escalatedMaxOutputTokens；step() switch default 分支新增 system.notification 透传 |
| `src/loop/handlers/llm.ts` | 修改 | handleLLMResponse() 新增 length 检测；callLLMInner() catchError 新增恢复逻辑；新增 emitSystemMessage()、callLLMWithOptions()、callLLMWithFallbackModel() |
| `tests/loop/error-analyzer.spec.ts` | **新建** | 单元测试：各错误类型分析、恢复策略判定 |
| `tests/loop/llm-error-recovery.spec.ts` | **新建** | 集成测试：模拟各类 LLM 错误，验证恢复流程 |

---

## 4. 测试计划

```typescript
// tests/loop/error-analyzer.spec.ts

describe('analyzeLLMError', () => {
  it('should classify finishReason=length as max_output_tokens', () => {
    const result = analyzeLLMError(new Error('test'), 'length')
    expect(result.category).toBe('llm_token_limit')
    expect(result.recoverable).toBe(true)
    expect(result.recovery).toBe('escalate_output_tokens')
  })

  it('should classify HTTP 413 as prompt_too_long', () => {
    const result = analyzeLLMError(new Error('prompt is too long'), undefined, 413)
    expect(result.recoverable).toBe(true)
    expect(result.recovery).toBe('trigger_compaction')
  })

  it('should classify HTTP 529 as model_overloaded', () => {
    const result = analyzeLLMError(new Error('overloaded'), undefined, 529)
    expect(result.recoverable).toBe(true)
    expect(result.recovery).toBe('switch_fallback_model')
  })

  it('should NOT auto-recover rate limits (429)', () => {
    const result = analyzeLLMError(new Error('rate limit'), undefined, 429)
    expect(result.recoverable).toBe(false)
  })

  it('should treat unknown errors as non-recoverable', () => {
    const result = analyzeLLMError(new Error('unknown'))
    expect(result.recoverable).toBe(false)
  })
})
```

```typescript
// tests/loop/llm-error-recovery.spec.ts

describe('LLM Error Recovery in Agent Loop', () => {
  it('should escalate output tokens on finishReason=length', async () => {
    // Mock LLM adapter: 第一次返回 finishReason=length, 第二次正常
    const mockLLM = new MockLLMAdapter([
      { content: 'part1', finishReason: 'length', usage: { promptTokens: 100, completionTokens: 4096 } },
      { content: 'part2', finishReason: 'stop', usage: { promptTokens: 105, completionTokens: 200 } },
    ])
    // ... 验证升级后重试成功
  })

  it('should inject recovery message after output escalation exhausted', async () => {
    // Mock: 连续返回 finishReason=length
  })

  it('should switch to fallback model on 529 error', async () => {
    // Mock: 第一次 529, fallback 模型正常
  })

  it('should trigger compaction on 413 error', async () => {
    // Mock: 第一次 413, 压缩后正常
  })

  it('should terminate after recovery attempts exhausted', async () => {
    // Mock: 连续 4 次 finishReason=length（超过 3 次限制）
  })
})
```

---

## 5. 与 ClaudeCode 的差异

| 维度 | ClaudeCode | AgentForge (本设计) |
|------|-----------|-------------------|
| 语言 | TypeScript (strict: false) | TypeScript (strict: true) + Zod |
| 循环模型 | AsyncGenerator while(true) + continue | RxJS expand() + of(newEvent) |
| 错误检测 | 分散在流循环内部 (withheld flags) | `analyzeLLMError()` 集中分析 |
| 状态管理 | 9 个独立变量在 while 外部 | `RecoveryState` 不可变记录在 AgentState |
| 恢复计数器 | 手动 reset | Zod schema 强制 schema 约束 |
| fallback 模型 | `fallbackModel` 字符串 | `fallbackModel: ModelConfig` 结构化 |
| 测试 | 无单元测试 | Vitest 覆盖 |
