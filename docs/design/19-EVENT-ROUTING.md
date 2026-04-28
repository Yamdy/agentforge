# 事件路由补全 — 设计文档

> 状态：待评审
> 阻塞等级：P1 — 事件已定义但未路由，导致 MCP 断连无感知、Workflow 无法暂停/恢复、Compaction 无法自动触发
> 预估工作量：1.5 天

---

## 1. 问题

`src/core/events.ts` 定义了 42 个事件类型。Agent Loop 的 `step()` 函数只路由了其中 10 个：

| 已路由 (switch case) | 未路由 (落入 default → EMPTY) |
|---|---|
| `agent.start` | `llm.stream.start` |
| `llm.request` | `llm.stream.text` |
| `llm.response` | `llm.stream.tool_call` |
| `llm.output.invalid` | `llm.stream.end` |
| `tool.call` | `tool.execute` |
| `tool.result` | `tool.result.delta` |
| `tool.batch.complete` | `tool.error` |
| `hitl.ask` | `tool.batch` / `tool.batch.start` |
| `hitl.answer` | `subagent.*` (除委托逻辑) |
| (通过 `callLLMStreaming`) | `mcp.*` (5个) |
| | `workflow.*` (7个) |
| | `compaction.*` (2个) |
| | `permission.*` (2个) |
| | `state.change` |
| | `context.updated` |
| | `llm.error` |
| | `checkpoint` |
| | `cancel` |

未路由的事件意味着：
- **MCP 断连静默丢失** — `mcp.disconnected` / `mcp.error` 无人处理
- **Workflow 无法暂停/恢复** — `workflow.suspend` / `workflow.resume` 无处理器
- **Compaction 不自动触发** — 消息超长时不会自动压缩
- **工具执行过程不可追踪** — `tool.execute` 发出后无人接

---

## 2. 设计原则

### 2.1 不是所有事件都需要处理器

Agent Loop 的 `step()` 有两种处理模式：

| 模式 | 行为 | 适用事件 |
|------|------|---------|
| **主动处理** | switch case 中有具体逻辑，返回新 Observable | `agent.start`, `llm.request`, `tool.call` 等 |
| **透传观察** | 无需逻辑，自动流到 subscriber | `state.change`, `checkpoint`, `llm.stream.*` 等 |

关键洞察：**当前 `default: return EMPTY` 会吞掉事件**。这意味着这些事件不会传递到 subscriber。这是 bug，不是特性。

### 2.2 修复策略

```
default 分支应该改为：
  - 已知但无需处理的 Layer 2/3 事件 → return of(sctx)  // 透传
  - 真正未知的类型 → return EMPTY  // 丢弃
```

但对 **需要主动处理** 的事件（如 `mcp.disconnected`、`compaction.start`），应该添加专门的 case。

---

## 3. 逐事件分析

### 3.1 LLM Stream 事件 (`llm.stream.*`)

**当前状态**：`callLLMStreaming()` 在 Observable 构造函数中**直接 emit** 这些事件到 subscriber，不经过 `step()` 的 switch。所以它们已经被正确处理了。

**结论**：✅ 无需改动。这些事件绕过了 `expand` 递归，直接通过 Observable 发射。

### 3.2 `llm.error`

**当前状态**：LLM 调用错误通过 `callLLM()` 的 `catchError` 已经转为 `agent.error` + `done`。

**结论**：✅ 无需改动。`llm.error` 事件用于观察性，应在 subscriber 层面处理。

### 3.3 `tool.execute` / `tool.result.delta` / `tool.error`

**当前状态**：
- `tool.execute` — 在 `executeSingleTool()` 内部直接 emit，不经过 switch
- `tool.result.delta` — 流式工具结果，类似 `llm.stream.text`
- `tool.error` — 在 `executeSingleTool()` 的 `catchError` 中处理

**结论**：✅ 无需改动。这些事件在 handler 函数内部已处理。

### 3.4 `tool.batch` / `tool.batch.start`

**当前状态**：`executeBatchTools()` 内部 emit 这些事件。

**结论**：✅ 无需改动。内部已处理。

### 3.5 `checkpoint`

**当前状态**：`emitCheckpoint()` 在 handler 中 emit，但 `step()` 没有 case。

**问题**：checkpoint 事件流到 subscriber 但不触发任何循环行为。这是**正确的**——checkpoint 是纯观察性事件。

**结论**：✅ 当前行为正确。只需从 switch 的 default 改为显式 case（见第 4 节）。

### 3.6 `cancel`

**当前状态**：`step()` 中没有 case。cancel 由 `takeUntilTerminal()` 操作符处理（在 `run()` 方法中）。

**结论**：✅ 无需改动。cancel 在 Observable 层面终结流。

### 3.7 `subagent.start` / `subagent.step` / `subagent.complete` / `subagent.error`

**当前状态**：在 `handleSubagentDelegation()` 中通过 `map` 直接传递。

**结论**：✅ 无需改动。这些事件正确地从子 agent 流冒泡到父级。

---

## 4. 需要主动处理的事件

### 4.1 MCP 生命周期事件

| 事件 | 需要的处理 |
|------|-----------|
| `mcp.connecting` | 纯观察性，透传 |
| `mcp.connected` | 更新可用工具列表 `ctx.tools` |
| `mcp.disconnected` | 发出警告，可能需要标记断连工具 |
| `mcp.tools_changed` | 更新可用工具列表，可能需要重新发送 `llm.request` |
| `mcp.error` | 根据严重程度决定是否终止 agent |

**问题**：MCP 事件目前由 `MCPClient` 直接 emit 到流中，但 Agent Loop 不处理它们。

**设计**：MCP 事件应该**由 MCPClient 自己在内部处理**，不需要经过 Agent Loop 的 `step()`。MCPClient 已经有重连逻辑和工具发现逻辑。Agent Loop 只需要**不吞掉**这些事件。

```typescript
// 在 step() 的 switch 中添加：
case 'mcp.connecting':
case 'mcp.connected':
case 'mcp.disconnected':
case 'mcp.tools_changed':
case 'mcp.error':
  // MCP 生命周期事件 — 透传给 subscriber，MCPClient 自行处理
  return of(sctx);
```

### 4.2 Workflow 事件

| 事件 | 需要的处理 |
|------|-----------|
| `workflow.start` | 纯观察性，透传 |
| `workflow.step.start` | 纯观察性，透传 |
| `workflow.step.end` | 纯观察性，透传 |
| `workflow.suspend` | **需要处理**：暂停 Agent Loop |
| `workflow.resume` | **需要处理**：恢复 Agent Loop |
| `workflow.complete` | 纯观察性，透传 |
| `workflow.error` | 根据严重程度决定 |

**关键设计：`workflow.suspend` / `workflow.resume`**

这与 HITL 的 pause/resume 模式同构：

```typescript
case 'workflow.suspend':
  // Workflow 暂停 — 与 HITL pause 类似
  // 返回等待 external resume 信号的 Observable
  if (ctx.pauseController) {
    // 可以利用已有的 pause/resume 机制
    return ctx.pauseController.onResume().pipe(
      take(1),
      mergeMap(() => {
        const resumeEvent: AgentEvent = {
          type: 'workflow.resume',
          timestamp: Date.now(),
          sessionId,
        };
        return from([
          { event: resumeEvent, state },
        ] as StepContext[]);
      }),
    );
  }
  // 无 pause controller — 透传
  return of(sctx);
```

但其实，Workflow 的 suspend/resume 语义不同于 HITL。Workflow suspend 是"工作流级暂停"，恢复可以是外部信号也可以是定时器。Agent Level 暂停 vs Workflow Level 暂停是两个不同概念。

**更简单的设计**：Workflow 事件由 `WorkflowExecutor` 内部处理（它已经有 suspend/resume 逻辑）。Agent Loop 只需**透传**：

```typescript
case 'workflow.start':
case 'workflow.step.start':
case 'workflow.step.end':
case 'workflow.suspend':
case 'workflow.resume':
case 'workflow.complete':
case 'workflow.error':
  // Workflow 事件 — 由 WorkflowExecutor 内部处理，Agent Loop 透传给 subscriber
  return of(sctx);
```

### 4.3 Compaction 事件

| 事件 | 需要的处理 |
|------|-----------|
| `compaction.start` | 纯观察性 |
| `compaction.complete` | 纯观察性 + 更新状态 |

**关键设计：Compaction 自动触发**

Compaction 应该在 `llm.request` 之前触发，而不是作为事件路由。已在设计文档 14-OBSERVABILITY 中描述了 compaction 触发条件：

```typescript
// 在 handleLLMRequest 中，发送 LLM 请求之前检查是否需要 compaction
function handleLLMRequest(state: AgentState): Observable<StepContext> {
  // 🔒 NEW: 检查是否需要 compaction
  if (shouldCompact(state) && ctx.compactionManager) {
    const compacted = ctx.compactionManager.compact(state.messages);
    const newState = { ...state, messages: compacted.messages };
    state = newState;
  }

  // 原有逻辑
  if (config.streaming) {
    return callLLMStreaming(state);
  }
  return callLLM(state);
}

function shouldCompact(state: AgentState): boolean {
  // 简单启发式：消息数量超过阈值
  const messageCount = state.messages.length;
  const estimatedTokens = estimateTokenCount(state.messages);
  return messageCount > 50 || estimatedTokens > state.maxSteps * 4000;
}
```

而 `compaction.start` / `compaction.complete` 事件在 CompactionManager 内部 emit，只需透传。

### 4.4 其他事件

| 事件 | 处理 |
|------|------|
| `state.change` | 纯观察性，透传 |
| `context.updated` | 纯观察性，透传 |
| `permission.prompt` | 由 Security 模块处理（17-SECURITY.md），暂透传 |
| `permission.decision` | 由 Security 模块处理，暂透传 |

---

## 5. 实现方案

### 5.1 修改 `step()` 函数的 default 分支

**当前**（吞掉所有未处理事件）：

```typescript
default:
  // Passive events don't trigger further actions
  return EMPTY;
```

**改为**（区分观察性事件和未知事件）：

```typescript
default: {
  // 观察性事件 — 透传给 subscriber，不触发循环行为
  if (isObservationEvent(event)) {
    return of(sctx);
  }
  // 真正未知的事件类型 — 丢弃
  return EMPTY;
}
```

### 5.2 添加 `isObservationEvent` 辅助函数

```typescript
/**
 * 判断事件是否为观察性事件（无需 Agent Loop 主动处理，透传即可）
 *
 * 这些事件由各自的子系统内部处理：
 * - MCP 事件由 MCPClient 处理
 * - Workflow 事件由 WorkflowExecutor 处理
 * - Compaction 事件由 CompactionManager 处理
 * - Permission 事件由 PermissionController 处理
 * - Checkpoint 事件是观察性的
 * - State/Context 变更是观察性的
 */
function isObservationEvent(event: AgentEvent): boolean {
  const observationTypes: AgentEventType[] = [
    // MCP 生命周期
    'mcp.connecting',
    'mcp.connected',
    'mcp.disconnected',
    'mcp.tools_changed',
    'mcp.error',
    // Workflow 生命周期
    'workflow.start',
    'workflow.step.start',
    'workflow.step.end',
    'workflow.suspend',
    'workflow.resume',
    'workflow.complete',
    'workflow.error',
    // Compaction 生命周期
    'compaction.start',
    'compaction.complete',
    // Permission 生命周期 (Security 模块实现后将有主动处理器)
    'permission.prompt',
    'permission.decision',
    // 观察性事件
    'checkpoint',
    'state.change',
    'context.updated',
    // LLM 流式事件 (已在 callLLMStreaming 中处理)
    'llm.stream.start',
    'llm.stream.text',
    'llm.stream.tool_call',
    'llm.stream.end',
    // 工具执行中间事件 (已在 handler 中处理)
    'tool.execute',
    'tool.result.delta',
    'tool.error',
    'tool.batch',
    'tool.batch.start',
    // LLM 错误
    'llm.error',
  ];

  return observationTypes.includes(event.type);
}
```

### 5.3 添加显式 case (可读性优先)

替代方案 — 为所有事件类型添加显式 case，提高可读性：

```typescript
switch (event.type) {
  // ... 现有 case ...

  // ===== Layer 2: 子系统生命周期 (透传) =====
  case 'mcp.connecting':
  case 'mcp.connected':
  case 'mcp.disconnected':
  case 'mcp.tools_changed':
  case 'mcp.error':
  case 'workflow.start':
  case 'workflow.step.start':
  case 'workflow.step.end':
  case 'workflow.suspend':
  case 'workflow.resume':
  case 'workflow.complete':
  case 'workflow.error':
  case 'compaction.start':
  case 'compaction.complete':
  case 'permission.prompt':
  case 'permission.decision':
  case 'subagent.start':
  case 'subagent.step':
  case 'subagent.complete':
  case 'subagent.error':
  case 'checkpoint':
  case 'state.change':
  case 'context.updated':
    return of(sctx);

  // ===== Layer 3: 仅观察性 (透传) =====
  case 'llm.stream.start':
  case 'llm.stream.text':
  case 'llm.stream.tool_call':
  case 'llm.stream.end':
  case 'llm.error':
  case 'tool.execute':
  case 'tool.result.delta':
  case 'tool.error':
  case 'tool.batch':
  case 'tool.batch.start':
    return of(sctx);

  default:
    // 真正未知的事件类型 — 丢弃并警告
    return EMPTY;
}
```

**推荐方案**：方案 5.3（显式 case），因为：
1. 所有事件类型都有文档化的 case，新开发者一眼能看懂路由全貌
2. TypeScript 的穷举检查能发现遗漏
3. default 返回 EMPTY 只留给未来可能新增的未知类型

### 5.4 Compaction 自动触发

在 `handleLLMRequest()` 前添加 compaction 检查：

```typescript
function handleLLMRequest(state: AgentState): Observable<StepContext> {
  // 🔒 NEW: 消息过长时自动压缩
  let currentState = state;
  if (ctx.compactionManager && shouldCompact(state)) {
    const result = ctx.compactionManager.compact(state.messages);
    currentState = {
      ...state,
      messages: result.compacted,
      contextManagement: {
        ...state.contextManagement,
        totalTokens: result.tokenCount,
        compactionCount: (state.contextManagement?.compactionCount ?? 0) + 1,
        lastCompactionAt: Date.now(),
      },
    };
  }

  if (config.streaming) {
    return callLLMStreaming(currentState);
  }
  return callLLM(currentState);
}
```

需要在 `AgentContext` 添加 `compactionManager?` 字段：

```typescript
export interface AgentContext {
  // ... 现有字段 ...

  /** Compaction manager for context window management (optional) */
  compactionManager?: CompactionManager;
}
```

---

## 6. 测试策略

| 场景 | 验证点 |
|------|--------|
| MCP 事件透传 | `mcp.connected` 通过 `step()` 后 subscriber 收到 |
| Workflow 事件透传 | `workflow.start` 通过 `step()` 后 subscriber 收到 |
| 未知事件 | 未知 type 被丢弃，不崩溃 |
| Compaction 触发 | 消息数 > 阈值时自动压缩 |
| Compaction 不触发 | 消息数 < 阈值时不压缩 |
| 分层覆盖 | 所有 42 个事件类型都有明确的 case 或内部处理 |

---

## 7. 变更清单

| 文件 | 变更 |
|------|------|
| `src/loop/agent-loop.ts` | `step()` switch 补充所有事件类型的 case |
| `src/loop/agent-loop.ts` | `handleLLMRequest()` 添加 compaction 检查 |
| `src/core/context.ts` | `AgentContext` 添加 `compactionManager?` |
| `src/core/context-builder.ts` | `ContextBuilder` 添加 `withCompactionManager()` |
| `tests/loop/agent-loop.spec.ts` | 新增事件透传和 compaction 触发测试 |

---

## 8. 评审补充说明

### 8.1 Compaction 触发的同步性约束

`handleLLMRequest()` 中 compaction 调用 `ctx.compactionManager.compact(state.messages)` 是**同步执行**的（使用 truncate 策略）。

**如果使用异步策略（如 summarize 调用 LLM 做摘要）**，`compact()` 返回 `CompactionResult` 但摘要可能在 Promise 中异步完成。此时：

- **首次 LLM 调用**：使用未压缩的消息（因为压缩还未完成）
- **后续 LLM 调用**：使用已压缩的消息（压缩已完成）

这是设计权衡，不是 bug。`CompactionManager` 的 `compact()` 方法设计为同步返回结果（truncate 立即生效），如果底层策略需要异步，应在 `CompactionManager` 内部管理 Promise 链和缓存。Agent Loop 不应等待异步压缩完成——那会阻塞整个事件流。

### 8.2 Subagent 事件的注释

在显式 case 中，`subagent.*` 事件标记为透传，但应加注释说明：

```typescript
// Subagent 事件 — 在 handleSubagentDelegation() 中已处理，
// 此处仅透传给 subscriber（冒泡到父级流）
case 'subagent.start':
case 'subagent.step':
case 'subagent.complete':
case 'subagent.error':
  return of(sctx);
```

### 8.3 `llm.error` 事件的合理性

`llm.error` 在当前实现中**理论不可达**（因为 `callLLM()` 的 `catchError` 已将 LLM 错误转为 `agent.error` + `done`）。在 switch 中列出它是**防御性代码**，确保如果有代码直接 emit `llm.error` 事件（如未来的 MCP 代理或测试），Agent Loop 不会吞掉它。

### 8.4 TypeScript 穷举检查

推荐使用 TypeScript 的 `switch` 穷举检查来确保所有 `AgentEventType` 都有 case。在 `default` 分支中添加：

```typescript
default: {
  // TypeScript 穷举检查：如果 AgentEventType 新增了值但 switch 没有处理，
  // 下面的 never 检查会产生编译错误
  const _exhaustive: never = event.type;
  // 运行时：未知事件类型丢弃
  return EMPTY;
}
```

这样当新增事件类型时，TypeScript 会强制要求在 switch 中添加对应的 case。