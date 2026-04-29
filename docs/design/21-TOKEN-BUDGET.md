# Token 预算 + 递减收益检测 — 设计文档

> 状态：待评审
> 阻塞等级：P1 — 无 token 预算意味着长对话可能无限消耗 token 直至上下文溢出
> 参考实现：ClaudeCode `src/query/tokenBudget.ts` (93 行)
> 预估工作量：0.5 天

---

## 1. 问题

当前 AgentForge 仅在 `handleToolResult` / `handleBatchComplete` 中通过 `maxSteps` 限制步数，但**缺少 token 级预算控制**：

- 步数限制是粗粒度的 — LLM 每次响应消耗的 token 差异极大（100～10000+）
- 无递减收益检测 — 即使每步只产出极少有效内容，Agent 仍会跑完所有步数
- 长对话没有 token 天花板，最终依赖 LLM 上下文窗口硬限制

### ClaudeCode 的解决方案

ClaudeCode 在每次 `queryLoop` 迭代**无需工具调用时**（即 LLM 给出最终答案时），执行 token 预算检查：

```typescript
// ClaudeCode src/query/tokenBudget.ts (精简逻辑)
const COMPLETION_THRESHOLD = 0.9   // 90% 预算时开始检测
const DIMINISHING_THRESHOLD = 500  // delta < 500 tokens 视为递减

function checkTokenBudget(tracker, agentId, budget, globalTurnTokens) {
  if (agentId || !budget) return { action: 'stop' }

  const pct = turnTokens / budget
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD

  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    // 继续 + 给模型一个微妙的 nudge
    return { action: 'continue', nudgeMessage: `...(${pct}% used)...` }
  }
  return { action: 'stop' }
}
```

**核心洞察：** 预算检查只发生在 LLM "打算完成" 时（即没有 tool_calls），而不是每次 LLM 调用后。这允许 Agent 在工具执行阶段自由消耗 token，只在"思考完成、准备输出"时才检查预算。

---

## 2. 设计

### 2.1 集成位置

**在 RxJS 事件流中，预算检查发生在这里：**

```
llm.request → [LLM call] → llm.response
  ├── 有 tool_calls  → tool.call → [tools] → tool.result → llm.request (循环)
  └── 无 tool_calls  → 🔴 预算检查点 → agent.complete 或 预算续期消息 → llm.request
```

对应 ClaudeCode 的逻辑：预算检查只在 `needsFollowUp === false` 时触发。

在 AgentForge 中，这个位置在 `handleLLMResponse()` 的 **`finishReason === 'stop'` 且无 toolCalls** 分支：

```typescript
// src/loop/handlers/llm.ts — handleLLMResponse()
if (finishReason === 'stop' || !toolCalls?.length) {
  // 🔴 在此处插入预算检查
  // 如果预算充足 → 正常完成
  // 如果预算在 90% 内但无递减 → 注入 nudge 消息，继续循环
  // 如果递减或超过 90% → 正常完成（停止）
}
```

### 2.2 新增类型

```typescript
// src/loop/token-budget.ts (新文件)

/**
 * Token 预算追踪器 — 跨循环迭代持久化。
 * 与 ClaudeCode 的 BudgetTracker 对齐但适配不可变状态。
 */
export interface TokenBudgetState {
  /** 预算续期计数（本次 turn 内的第几次续期） */
  continuationCount: number
  /** 上次检查时的 delta（本次检查的产出 token 减去上次检查的产出 token） */
  lastDeltaTokens: number
  /** 上次检查时的全局累积 token */
  lastGlobalTurnTokens: number
  /** 预算检查开始时间 */
  startedAt: number
}

export const DEFAULT_TOKEN_BUDGET = 200_000 // 默认 200K token 预算

/** 预算阈值常量 */
export const COMPLETION_THRESHOLD = 0.9   // 达到 90% 开始检测递减
export const DIMINISHING_THRESHOLD = 500   // delta < 500 视为收益递减

/**
 * 创建初始预算状态
 */
export function createTokenBudgetState(): TokenBudgetState {
  return {
    continuationCount: 0,
    lastDeltaTokens: 0,
    lastGlobalTurnTokens: 0,
    startedAt: Date.now(),
  }
}

export type BudgetDecision =
  | { action: 'continue'; nudgeMessage: string }
  | { action: 'stop'; reason: 'budget_exhausted' | 'diminishing_returns' | 'not_applicable' }

/**
 * 检查 token 预算并返回决策。
 *
 * 仅在主 Agent（非子代理）且 budget > 0 时生效。
 * 子代理不受预算限制 — 它们有独立的 maxSteps 控制。
 */
export function checkTokenBudget(
  state: TokenBudgetState,
  budget: number,
  currentTurnTokens: number,
  isSubagent: boolean,
): BudgetDecision {
  // 子代理不受预算限制
  if (isSubagent || budget <= 0) {
    return { action: 'stop', reason: 'not_applicable' }
  }

  const pct = Math.round((currentTurnTokens / budget) * 100)
  const deltaSinceLastCheck = currentTurnTokens - state.lastGlobalTurnTokens

  // 递减收益检测：连续 3+ 次续期且最近两次 delta 均低于阈值
  const isDiminishing =
    state.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    state.lastDeltaTokens < DIMINISHING_THRESHOLD

  // 未达到 90% 且无递减 → 允许继续
  if (!isDiminishing && currentTurnTokens < budget * COMPLETION_THRESHOLD) {
    return {
      action: 'continue',
      nudgeMessage: [
        `You have used ${pct}% (${currentTurnTokens.toLocaleString()} / ${budget.toLocaleString()} tokens) of your token budget.`,
        `You may continue if there is more work to do, but aim for efficient responses.`,
      ].join(' '),
    }
  }

  // 递减或超 90% → 停止
  if (isDiminishing) {
    return { action: 'stop', reason: 'diminishing_returns' }
  }
  return { action: 'stop', reason: 'budget_exhausted' }
}
```

### 2.3 AgentState 扩展

```typescript
// src/core/state.ts — AgentStateSchema 新增字段

export const AgentStateSchema = z.object({
  // ... 现有字段 ...

  /** Token budget state for diminishing returns detection */
  tokenBudget: z.object({
    continuationCount: z.number(),
    lastDeltaTokens: z.number(),
    lastGlobalTurnTokens: z.number(),
    startedAt: z.number(),
  }).optional(),
})
```

### 2.4 AgentLoopConfig 扩展

```typescript
// src/loop/agent-loop.ts — AgentLoopConfig 新增字段

export interface AgentLoopConfig {
  // ... 现有字段 ...

  /**
   * Token budget limit for the entire agent turn.
   * When set, the agent will check budget after each "completion attempt"
   * (i.e., when the LLM returns stop without tool calls).
   *
   * Default: 200_000 (200K tokens)
   * Set to 0 to disable budget checking.
   */
  tokenBudget?: number
}
```

### 2.5 核心逻辑集成

修改 `handleLLMResponse()` 中的 "完成" 分支：

```typescript
// src/loop/handlers/llm.ts — handleLLMResponse() 修改

if (finishReason === 'stop' || !toolCalls?.length) {
  // 🔴 新增：Token 预算检查
  const budget = config.tokenBudget ?? DEFAULT_TOKEN_BUDGET
  const currentTokens = state.tokens.prompt + state.tokens.completion
  const budgetState = state.tokenBudget ?? createTokenBudgetState()
  const isSubagent = !!ctx.subagentInfo // Context 中标记是否为子代理

  const decision = checkTokenBudget(budgetState, budget, currentTokens, isSubagent)

  if (decision.action === 'continue') {
    // 注入 nudge 消息，继续循环
    const nudgeMessage: Message = {
      role: 'user',
      content: decision.nudgeMessage,
    }
    const updatedBudgetState: TokenBudgetState = {
      continuationCount: budgetState.continuationCount + 1,
      lastDeltaTokens: currentTokens - budgetState.lastGlobalTurnTokens,
      lastGlobalTurnTokens: currentTokens,
      startedAt: budgetState.startedAt,
    }
    const newState: AgentState = {
      ...state,
      messages: [...state.messages, nudgeMessage],
      tokenBudget: updatedBudgetState,
    }

    // 发射 llm.request 继续循环（不发射 agent.complete）
    const requestEvent: AgentEvent = {
      type: 'llm.request',
      timestamp: Date.now(),
      sessionId,
      messages: newState.messages,
      model: config.model,
      tools: ctx.tools.list(),
    }
    return concat(
      checkpoint$,
      of({ event: requestEvent, state: newState } as StepContext)
    )
  }

  // 停止 — 正常完成流程
  const completeEvent: AgentEvent = { /* 原有逻辑 */ }
  const doneEvent: AgentEvent = { /* 原有逻辑 */ }
  return concat(checkpoint$, from([...] as StepContext[]))
}
```

### 2.6 辅助：累积 token 计算

当前 `AgentState.tokens` 是累积的（在 `handleLLMResponse` 中通过 `ctx.quota.consume()` 更新）。预算检查使用 `state.tokens.prompt + state.tokens.completion` 作为累积 token 计数，与 ClaudeCode 的 `globalTurnTokens` 对齐。

如果 `ctx.quota` 未配置（quota 可选），需要确保 `state.tokens` 仍然在 LLM 响应后被更新。检查 `handleLLMResponse()` 中：

```typescript
// 现有代码 — llm.ts handleLLMResponse()
if (ctx.quota && event.usage) {
  ctx.quota.consume(sessionId, {
    promptTokens: event.usage.promptTokens,
    completionTokens: event.usage.completionTokens,
  })
}
```

**需要修改：** 无论 `ctx.quota` 是否存在，都更新 `state.tokens`：

```typescript
// 新增：始终更新 state.tokens（预算检查需要，不依赖 quota）
const updatedTokens = event.usage
  ? {
      prompt: state.tokens.prompt + event.usage.promptTokens,
      completion: state.tokens.completion + event.usage.completionTokens,
    }
  : state.tokens

const stateWithTokens = { ...state, tokens: updatedTokens }

// Quota consume 仍然 fire-and-forget（非阻塞）
if (ctx.quota && event.usage) {
  ctx.quota.consume(sessionId, {
    promptTokens: event.usage.promptTokens,
    completionTokens: event.usage.completionTokens,
  })
}
```

### 2.7 事件流示意

```
                    ┌──────────────────────┐
                    │   llm.response       │
                    │   finishReason=stop  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  checkTokenBudget()  │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    action=stop         action=continue    action=stop
    (not_applicable)    (nudge + loop)    (diminishing/
              │                │           budget_exhausted)
              │                │                │
    ┌─────────▼──────┐  ┌──────▼────────┐  ┌───▼──────────┐
    │ agent.complete │  │ inject nudge  │  │ agent.complete│
    │ done(reason=   │  │ → llm.request │  │ done(reason=  │
    │   stop)        │  │ (continue)    │  │   stop)       │
    └────────────────┘  └───────────────┘  └───────────────┘
```

---

## 3. 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/loop/token-budget.ts` | **新建** | TokenBudgetState、checkTokenBudget()、常量 |
| `src/core/state.ts` | 修改 | AgentStateSchema 新增 tokenBudget 字段 |
| `src/loop/agent-loop.ts` | 修改 | AgentLoopConfig 新增 tokenBudget 配置 |
| `src/loop/handlers/llm.ts` | 修改 | handleLLMResponse() 完成分支插入预算检查；始终更新 state.tokens |
| `tests/loop/token-budget.spec.ts` | **新建** | 单元测试：预算检查逻辑、递减检测 |

---

## 4. 测试计划

```typescript
// tests/loop/token-budget.spec.ts

describe('checkTokenBudget', () => {
  it('should allow continuation when below 90% and not diminishing', () => {
    const state = createTokenBudgetState()
    const result = checkTokenBudget(state, 100000, 50000, false)
    expect(result.action).toBe('continue')
  })

  it('should stop when above 90% without nudge history', () => {
    const state = createTokenBudgetState()
    const result = checkTokenBudget(state, 100000, 95000, false)
    expect(result.action).toBe('stop')
  })

  it('should stop on diminishing returns (3 continuations + low delta)', () => {
    const state: TokenBudgetState = {
      continuationCount: 3,
      lastDeltaTokens: 100,
      lastGlobalTurnTokens: 50000,
      startedAt: Date.now(),
    }
    const result = checkTokenBudget(state, 100000, 50200, false)
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('diminishing_returns')
  })

  it('should skip check for subagents', () => {
    const state = createTokenBudgetState()
    const result = checkTokenBudget(state, 100000, 99999, true)
    expect(result.action).toBe('stop')
    expect(result.reason).toBe('not_applicable')
  })
})
```

---

## 5. 与 ClaudeCode 的差异

| 维度 | ClaudeCode | AgentForge (本设计) |
|------|-----------|-------------------|
| 语言 | TypeScript (strict: false) | TypeScript (strict: true) + Zod |
| 循环模型 | AsyncGenerator while(true) | RxJS expand() 递归 |
| 预算持久化 | 外层变量 `budgetTracker` | `AgentState.tokenBudget` 不可变 |
| 子代理豁免 | `if (agentId) return stop` | `if (isSubagent) return stop` |
| nudge 消息 | 内联英文提示 | 内联英文提示（可国际化） |
| 默认预算 | 由 GrowthBook `getCurrentTurnTokenBudget()` | 配置 `tokenBudget` (默认 200K) |
| 测试 | 无单元测试 | Vitest 覆盖 |
