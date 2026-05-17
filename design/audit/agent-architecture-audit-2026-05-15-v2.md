# Agent Architecture Audit Report (第三轮 — 三形态/7模块/12层交叉审计)

**Date**: 2026-05-15 (第三轮)
**Auditor**: Claude (ecc:agent-architecture-audit)
**Baseline**: 第二轮审计 (2026-05-15) — 6 个发现 (N-1~N-6)，本轮验证修复状态 + 发现新结构性问题

---

## Executive Verdict

| Field | Value |
|-------|-------|
| Overall Health | **Low Risk** |
| Primary Failure Mode | LoopOrchestrator 三重复制是最大维护风险；requiredTools 是建议性约束而非强制 |
| Most Urgent Fix | 合并 runLoop/streamLoop/streamEvents 为单一模板方法 |

上一轮的 6 个发现中 5 个已完全修复，1 个半修。7 模块现在全部功能完备。本轮发现的是更高层次的结构性问题。

---

## 上轮发现修复状态

| # | 发现 | 修复状态 | 证据 |
|---|------|----------|------|
| N-1 | Default CheckpointStore InMemory | ✅ 已修 | `loop-orchestrator.ts:50` 默认 `JsonlCheckpointStore` |
| N-2 | Default Compression Trivial Truncation | ✅ 已修 | `context-builder.ts:83` 默认 `semanticTruncation` |
| N-3 | Pipeline 不实现 flow-as-data | ⚠️ 半修 | 构造函数支持 `stageConfig`，但插件 API (`HarnessAPI`) 无方法修改 stages |
| N-4 | No Unified Harness API | ✅ 已修 | `harness.ts` `HarnessAPIImpl` 聚合全部能力 |
| N-5 | Compat Rules Opaque | ✅ 已修 | `applyReactiveRules` 返回 `{ history, diff }`，`compat:diff` 事件已发射 |
| N-6 | Three-Form/7-Module 未文档化 | ✅ 已修 | `CLAUDE.md` 包含完整映射表 |

---

## Three-Form -> Code Mapping (本轮验证)

```
Form 1 (Agent Loop = while+LLM+tools)
  while loop       -> LoopOrchestrator.runLoop/streamLoop/streamLoop  OK (但三重复制)
  LLM call         -> LLMInvoker.invoke/stream                        OK
  Tools            -> ToolRegistry + executeTools processor            OK
  Context assembly -> ContextBuilder.assemble                         OK (semanticTruncation 默认)

Form 2 (Harness = observe+control+intervene)
  observe          -> EventSystem + span attributes + events           OK
  control          -> StateMachine + token cap + step limit            OK
  intervene        -> HookManager + compat rules + abort               OK

Form 3 (Runtime = EventBus+LifecycleState+Hooks)
  EventBus         -> EventSystem (EventBus + replay)                  OK
  LifecycleState   -> StateMachine (inside LoopOrchestrator)           OK
  Hooks            -> HookManager                                       OK
```

三形态能力全部存在且连贯。Form 2 的 control 能力散布在三个重复的循环实现中。

---

## AOP Three Methods -> Code Mapping (本轮验证)

```
Method 1 (callback/hook)    -> HookManager, tool before/after hooks     OK Complete
Method 2 (flow as data)     -> Pipeline StageConfig                     WARN (构造函数可配，插件不可)
Method 3 (side observing)   -> EventSystem (emit + replay)              OK Complete
```

---

## 7-Module Status (本轮验证)

| # | Module | Status | Detail |
|---|--------|--------|--------|
| 1 | PipelineRunner | OK | 稳定，但 LoopOrchestrator 上层有三重复制 |
| 2 | ContextBuilder | OK | semanticTruncation 默认，多 pass 压缩，profile 支持 |
| 3 | LLMInvoker | OK | streamWithRetry，span 追踪，reasoning |
| 4 | ToolRegistry | OK | before/after hooks，output 验证，truncation |
| 5 | EventSystem | OK | EventBus + replay + backend |
| 6 | HookManager | OK | profiles (minimal/standard/strict)，优先级，禁用点 |
| 7 | CheckpointStore | OK | JsonlCheckpointStore 默认 |

**7/7 模块功能完备。** 问题不在模块本身，在模块之上的编排层。

---

## Findings

### A-1 [HIGH] LoopOrchestrator 三重复制

- **Layer**: 结构性（非 12 层中任一）
- **Mechanism**: `runLoop` (L63-143) / `streamLoop` (L154-250) / `streamEvents` (L252-348) 三个方法共享完全相同的循环逻辑：compat retry、abort、suspend、checkpoint、iteration.end hook、autoCheckpoint。约 200 行逻辑重复三次。
- **Root cause**: `run()` 返回 `PipelineContext`，`stream()` 返回 `AsyncGenerator<string>`，`streamEvents()` 返回 `AsyncGenerator<StreamEvent>`。三种返回类型导致实现分叉。
- **Evidence**: `loop-orchestrator.ts:63-348`
- **Confidence**: 0.95
- **Fix**: 提取共享循环逻辑为单一模板方法，三个公开方法只负责结果适配。

### A-2 [HIGH] requiredTools 是建议性约束而非强制

- **12-layer map**: Layer 6 (Tool Selection) + Layer 7 (Tool Execution)
- **Mechanism**: `evaluate-iteration.ts:156-163` 注入 `[system] Required tools not yet called: ... Please call them before finishing.` 作为 promptFragment。这是 "must use tool" 写在 prompt text 中的经典反模式。3 次重试后停止循环，但从未实际执行工具。
- **Root cause**: 没有代码级别的工具调用强制机制。AgentForge 的设计是 "LLM 决定调工具" 而非 "框架强制调工具"。
- **Evidence**: `evaluate-iteration.ts:156-163`, `evaluate-iteration.ts:118-147`
- **Confidence**: 0.88
- **Fix**: 在 requiredTools 未满足时，`executeTools` processor 可以自动构造 tool call（使用默认参数或从上下文推断），而非仅靠 prompt 提醒。或者提供 `requiredToolPolicy: 'enforce' | 'advise'` 选项。

### A-3 [MEDIUM] Compat Retry 是隐式修复循环

- **12-layer map**: Layer 11 (Hidden repair loops)
- **Mechanism**: `loop-orchestrator.ts:88-103` (runLoop) / `207-225` (streamLoop) / `304-323` (streamEvents)。当 LLM 调用失败时，`applyReactiveRules` 静默修改 messageHistory 并重试。最多 3 次。用户不订阅 `compat:retry` 事件则完全不可见。
- **Root cause**: 设计选择——provider 兼容性修复应该是透明的。但透明到完全不可见就有审计风险。
- **Evidence**: `loop-orchestrator.ts:88-103`, `provider-history-compat.ts:155-182`
- **Confidence**: 0.82
- **Fix**: 在 `AgentRunResult` 中增加 `compatRetries` 字段，让调用方至少知道发生了重试。或者在 agent.end hook 中包含 compat 统计。

### A-4 [MEDIUM] 插件不能修改 Pipeline Stage 顺序

- **AOP map**: Method 2 (flow as data) 半实现
- **Mechanism**: `LoopOrchestrator` 构造函数接受 `stageConfig`（L48），但 `HarnessAPIImpl` 没有 `modifyStages()` 方法。插件只能通过 `HarnessAPI.registerProcessor()` 往已有 stage 名上挂 processor。
- **Root cause**: 安全考虑——允许插件重排 stages 可能破坏循环不变量。但 "flow as data" 的承诺要求这个能力。
- **Evidence**: `harness.ts:35` (只有 `registerProcessor`), `loop-orchestrator.ts:48`
- **Confidence**: 0.85
- **Fix**: 在 `HarnessAPI` 中增加 `insertStage(after, newStage)` 和 `removeStage(stage)` 方法，LoopOrchestrator 在循环开始时从插件注册中动态构建 stage 数组。

### A-5 [MEDIUM] _model 缓存无失效机制

- **12-layer map**: Layer 12 (Persistence — stale cached artifacts)
- **Mechanism**: `agent.ts:230-233`。首次 `getLLM()` 解析模型，后续复用。credentials 过期、provider 切换、模型下线都无法恢复。
- **Evidence**: `agent.ts:230-233`
- **Confidence**: 0.75
- **Fix**: 添加 `_modelInvalidated` 标志 + `invalidateModel()` 方法。在 LLM 调用失败且错误类型为 auth/not-found 时自动失效。

### A-6 [LOW] _compatFixed 标志污染消息历史

- **12-layer map**: Layer 2 (Session history)
- **Mechanism**: `provider-history-compat.ts:174` 在修复后的消息上添加 `_compatFixed: true`。此字段随消息历史持久化，可能传给下游 processor 或 LLM provider。
- **Evidence**: `provider-history-compat.ts:174`
- **Confidence**: 0.60
- **Fix**: 在 `applyReactiveRules` 返回前 strip `_compatFixed` 字段，或使用 Symbol 作为 key 避免序列化。

### A-7 [LOW] gateTool/gateLLM 是空处理器

- **Mechanism**: `gate-tool.ts:3-6` 是空实现。每次迭代都调度到这些空 stage，增加不必要的处理器查找开销。
- **Evidence**: `gate-tool.ts:3-6`
- **Confidence**: 0.55
- **Fix**: 保留为扩展点，但在 `PipelineRunner.executeStage` 中对无注册处理器的 stage 跳过 hook 调用。

---

## Ordered Fix Plan

| # | Goal | Why Now | Expected Effect |
|---|------|---------|-----------------|
| 1 | 合并 LoopOrchestrator 三重复制 | 任何 bug/feature 必须改 3 处 = 必漏 | 单一维护点，新 loop 行为零成本添加 |
| 2 | requiredTools 代码级强制 | prompt-only 约束 = model 可忽略 | "required" 语义名副其实 |
| 3 | 插件 stageConfig 运行时可修改 | flow-as-data 半实现 | 完整 Method 2 AOP 能力 |
| 4 | compat retry 统计暴露 | 隐式重试不可审计 | AgentRunResult 中可见 compat 重试次数 |
| 5 | model 缓存失效机制 | stale model 无恢复路径 | auth 失败自动重新解析 |

---

## Ultimate Judgment

```
上轮:  Capability 7/7  OK  ->  本轮:  Capability 7/7  OK  (稳定)
       Default     5/7  WARN ->         Default     7/7  OK  (全部修复)
       Legibility  3/7  ERR  ->         Legibility  5/7  WARN (文档在，但代码有重复)

目标:  维护风险    7/7  <-  LoopOrchestrator 三重复制 + requiredTools 不强制
       插件完整性  6/7  <-  stageConfig 不对插件开放
```

**与前两轮的本质区别：**
- 第一轮（5/14）：7 模块缺 3 个 -> "功能缺失"
- 第二轮（5/15 早期）：功能全但默认不安全 -> "默认安全"
- 第三轮（本轮）：功能全 + 默认安全，但编排层有重复 + 约束有缺口 -> "结构债务"

---

## 三形态/7模块/12层 完整交叉映射

```
                  Layer 1-4       Layer 5-8       Layer 9-12
                 (Context)       (Execution)    (Delivery/Persist)
Form 1 (Loop)   ContextBuilder   LLMInvoker     -
                -> assemble()    ToolRegistry
                -> trimHistory() -> executeTool()

Form 2 (Harness) ContextBuilder  HookManager     CheckpointStore
                -> budget check  -> tool gates    -> serialize()
                EventSystem      -> compat rules  LoopOrchestrator
                -> span attrs    -> abort         -> autoCheckpoint

Form 3 (Runtime) EventSystem      HookManager     StateMachine
                -> emit()         -> profiles      -> transitions
                -> replay()       -> priorities    -> lifecycle events

7-Module:
  1. PipelineRunner  -> Form 1 骨架
  2. ContextBuilder   -> Form 1 输入准备 + Form 2 预算控制
  3. LLMInvoker       -> Form 1 LLM 调用
  4. ToolRegistry     -> Form 1 工具执行 + Form 2 工具门控
  5. EventSystem      -> Form 2 observe + Form 3 emit/replay
  6. HookManager      -> Form 2 intervene + Form 3 注册/调度
  7. CheckpointStore  -> Form 2 control 持久化
```

---

## Related

- 第二轮审计: `docs/audit/agent-architecture-audit-2026-05-15.md`
- 第一轮审计: `docs/audit/agent-architecture-audit-2026-05.md`
- 7-Module 架构: project memory `project-production-agent-7-modules`
- Agent 设计第一性原理: project memory `project-agent-design-from-first-principles`
- AOP 第一性原理: project memory `project-aop-first-principles`
