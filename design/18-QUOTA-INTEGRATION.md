# Quota 集成到 Agent Loop — 设计文档

> 状态：待评审
> 阻塞等级：P0 — 无 quota check 意味着一个死循环或 LLM 异常响应就能烧光 API 额度
> 预估工作量：0.5 天

---

## 1. 问题

`QuotaController` 和 `MemoryQuotaController` 已完整实现（`src/quota/`），但**没有任何代码调用它们**：

- `AgentContext` 没有 `quota` 字段
- `AgentLoopConfig` 没有 `quota` 配置
- `callLLM()` / `callLLMStreaming()` 没有在调用前做 quota check
- `handleLLMResponse()` 没有在响应后记录 token consumption
- `ContextBuilder` 没有 `withQuota()` 方法

结果是：没有任何成本控制。一个 bug（如 LLM 返回巨大响应）或恶意输入就能导致无限 API 消费。

---

## 2. 设计

### 2.1 AgentContext 扩展

```typescript
// src/core/context.ts — AgentContext 新增字段

export interface AgentContext {
  // ... 现有字段 ...

  /** Token/Cost quota controller (optional) */
  quota?: QuotaController;
}
```

**为什么是可选？** 遵循已有模式（`hitl?`, `mcp?`, `subagents?`）。不配置 = 不检查 = 零开销。

### 2.2 AgentLoopConfig 扩展

```typescript
// src/core/context.ts — AgentConfig 新增字段

export interface AgentConfig {
  // ... 现有字段 ...

  /** Quota limits (optional). When set, enables quota checking before LLM calls. */
  quota?: QuotaLimits;
}
```

`QuotaLimits` 已定义在 `src/quota/quota-controller.ts`：

```typescript
export interface QuotaLimits {
  maxPromptTokens: number;
  maxCompletionTokens: number;
  maxTotalCost?: number;
}
```

只有 limits，没有 controller — controller 由框架自动创建（`MemoryQuotaController`）或用户手动注入（`ctx.quota`）。

### 2.3 Agent Loop 集成点

集成发生在两个位置：

#### 位置 1: `callLLM()` — 调用前检查

```typescript
// src/loop/agent-loop.ts — callLLM 函数修改

function callLLM(state: AgentState, repairAttempt: number = 0): Observable<StepContext> {
  // 🔒 NEW: Quota pre-check
  if (ctx.quota) {
    const projected: QuotaUsage = {
      promptTokens: estimateTokenCount(state.messages),
      completionTokens: 0, // 未知，预估为 0
    };

    // from(Promise) → 避免 expand 内直接 Promise 导致的重复发射
    return from(ctx.quota.check(sessionId, projected)).pipe(
      mergeMap(allowed => {
        if (!allowed) {
          // Quota 耗尽 → agent.error + done (errors-as-events 模式)
          const errorEvent: AgentEvent = {
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId,
            error: {
              name: 'QuotaExceededError',
              message: 'Token quota exceeded. Increase limits or check usage.',
            },
            step: state.step,
          };
          const doneEvent: AgentEvent = {
            type: 'done',
            timestamp: Date.now(),
            sessionId,
            reason: 'error',
          };
          return from([
            { event: errorEvent, state },
            { event: doneEvent, state },
          ] as StepContext[]);
        }

        // Quota 通过 → 继续调用
        return callLLMInner(state, repairAttempt);
      }),
      catchError(error => {
        // Quota check 本身失败 → 优雅降级（允许通过）
        // 设计原则：QuotaController.missing = allowed
        console.warn('Quota check failed, allowing request:', error);
        return callLLMInner(state, repairAttempt);
      }),
    );
  }

  // 无 quota → 直接调用
  return callLLMInner(state, repairAttempt);
}
```

#### 位置 2: `handleLLMResponse()` — 响应后记录

```typescript
// src/loop/agent-loop.ts — handleLLMResponse 函数修改

function handleLLMResponse(
  state: AgentState,
  event: Extract<AgentEvent, { type: 'llm.response' }>,
  _repairAttempt?: number
): Observable<StepContext> {
  // 🔒 NEW: 记录 token 消耗 (fire-and-forget)
  if (ctx.quota && event.usage) {
    ctx.quota.consume(sessionId, {
      promptTokens: event.usage.promptTokens,
      completionTokens: event.usage.completionTokens,
      totalCost: event.usage.totalCost, // 如果 adapter 提供
    });
  }

  // ... 原有逻辑不变 ...
}
```

### 2.4 流式响应集成

`callLLMStreaming()` 也需要在开始前做 quota check，在结束后记录消耗：

```typescript
// callLLMStreaming 中：
// 1. 在 new Observable 构造函数里，先做 quota check（与 callLLM 相同）
// 2. 在 stream complete 时，累加 accumulatedUsage 并 consume
```

### 2.5 ContextBuilder 扩展

```typescript
// src/core/context-builder.ts — 新增方法

withQuota(quota: QuotaController): this {
  this.context.quota = quota;
  return this;
}
```

### 2.6 createDefaultAppServices 集成

```typescript
// src/core/context.ts — createDefaultAppServices 或 createAgent 中

// 如果 config.quota 存在，自动创建 MemoryQuotaController
if (config.quota && !ctx.quota) {
  ctx.quota = new MemoryQuotaController(config.quota);
}
```

### 2.7 Token 估算

`estimateTokenCount` 是一个必要的辅助函数：

```typescript
// src/loop/agent-loop.ts 或 src/core/utils.ts

/**
 * 粗略估算消息 token 数。
 * 规则：英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token。
 * 取 3 字符 = 1 token 作为通用估算。
 * 生产环境可用 tiktoken 精确计算，此处仅做前置估算。
 */
function estimateTokenCount(messages: Message[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += typeof msg.content === 'string' ? msg.content.length : 0;
  }
  return Math.ceil(totalChars / 3);
}
```

### 2.8 新增事件类型

不需要新增事件类型。Quota 耗尽使用已有的 `agent.error` + `done` 事件， error name 为 `QuotaExceededError`。

---

## 3. 测试策略

| 测试场景 | 验证点 |
|---------|--------|
| `ctx.quota` 未设置 | LLM 调用正常，无 quota 检查 |
| `ctx.quota.check()` 返回 true | LLM 调用正常 |
| `ctx.quota.check()` 返回 false | 发出 `agent.error` (QuotaExceededError) + `done`，**不调用 LLM** |
| `ctx.quota.check()` 抛出异常 | 优雅降级，允许调用通过 |
| `ctx.quota.consume()` 正常 | 在 `llm.response` 后调用，记录 usage |
| `ctx.quota.consume()` 无 usage | `event.usage` 为 undefined 时不调用 consume |
| 流式模式下 quota | `callLLMStreaming` 同样检查 quota |
| 多步对话累积 | 连续 LLM 调用后 `quota.getUsage()` 正确累积 |

---

## 4. 变更清单

| 文件 | 变更 |
|------|------|
| `src/core/context.ts` | `AgentContext` 添加 `quota?: QuotaController` |
| `src/core/context.ts` | `AgentConfig` 添加 `quota?: QuotaLimits` |
| `src/core/context.ts` | `createDefaultAppServices` / `createAgent` 中自动创建 `MemoryQuotaController` |
| `src/core/context-builder.ts` | `ContextBuilder` 添加 `withQuota()` |
| `src/core/index.ts` | 重新导出 `QuotaController`, `QuotaUsage`, `QuotaLimits` |
| `src/loop/agent-loop.ts` | `callLLM()` 添加 quota pre-check |
| `src/loop/agent-loop.ts` | `callLLMStreaming()` 添加 quota pre-check |
| `src/loop/agent-loop.ts` | `handleLLMResponse()` 添加 quota.consume |
| `src/index.ts` | 导出 quota 模块公共 API |
| `tests/loop/agent-loop.spec.ts` | 新增 quota 集成测试场景 |

---

## 5. 不做的事

- ❌ 不实现分布式 quota 存储（Redis 等）— `QuotaController` 接口已支持，用户自行实现
- ❌ 不在 `QuotaController` 上添加事件发射 — consume 是 fire-and-forget
- ❌ 不修改 `QuotaController` 接口本身 — 已有接口足够
- ❌ 不添加 quota 中间件/plugin — 直接在 Agent Loop 中集成，更简单可靠

---

## 6. 评审补充说明

### 6.1 `consume()` 的 fire-and-forget 语义

`handleLLMResponse()` 中的 `ctx.quota.consume()` 是同步调用，不 await。对 `MemoryQuotaController`（同步实现）毫无问题。但如果用户替换为异步存储实现的 `QuotaController`（如 Redis），`consume()` 返回 `void`——它必须自行保证最终一致性（内部 fire-and-forget 或自带重试）。

**约束**：`QuotaController.consume()` 的接口签名是 `(sessionId: string, usage: QuotaUsage) => void`。任何实现必须在此签名下保证操作最终完成，Agent Loop 不会 await 它。如需异步回写，实现内部应自行管理 Promise 链和重试逻辑。

### 6.2 Token 估算精度

`estimateTokenCount()` 使用 `字符数 / 3` 粗略估算（误差 ±30%）。这是 pre-check 阶段的充分近似：

- **目的**：防止明显超限的请求（如已在 100K 中用了 95K，又发一个 10K 的请求）
- **精确值**：由 `handleLLMResponse()` 中的 LLM 返回 `usage.promptTokens / completionTokens` 记录
- **权衡**：如果需要精确 pre-check，可以注入 `tiktoken` 作为 `TokenCounter` 实现，但在 1.0 中不引入此依赖

### 6.3 `usage` 字段可达性

`llm.response` 事件中的 `usage` 字段类型为 `LLMUsage | undefined`。设计中文档已标注 `if (ctx.quota && event.usage)`，即只在 `usage` 存在时调用 consume。对于不返回 `usage` 的 LLM adapter（如某些本地模型），quota consume 不会被调用——这是正确的降级行为。