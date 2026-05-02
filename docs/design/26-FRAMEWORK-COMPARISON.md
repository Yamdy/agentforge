# Agent 框架横向对比 — AgentForge vs 业界

> 参考对象：ClaudeCode、OpenCode、OpenHarness、DeepAgents、Mastra、AgentScope
> 目的：验证 AgentForge 重构方向的正确性，识别遗漏

---

## 1. 核心循环对比

| 框架 | 循环模型 | 语言 | 外部依赖 |
|------|---------|------|---------|
| **ClaudeCode** | `async function* queryLoop()` — AsyncGenerator + `while(true)` | TS | 无 |
| **OpenCode** | Effect Layer + Event Bus + imperative 控制 | TS | Effect-TS |
| **OpenHarness** | `while True: await api.stream()` — imperative | Python | 无 |
| **DeepAgents** | LangGraph state graph（编译后的图执行） | Python | LangGraph |
| **Mastra** | Agent + Workflow 双模型，Workflow 用 graph engine | TS | 自研 graph engine |
| **AgentScope** | `async agent(msg)` ReActAgent — imperative | Python | 无 |
| **AgentForge** | `async function while(true)` + `AgentEventEmitter` | TS | **无** |

**结论**：6 个参考框架中，4 个用 imperative 循环（ClaudeCode、OpenHarness、AgentScope、Mastra Agent），1 个用 graph engine（DeepAgents），1 个用 Effect（OpenCode）。AgentForge 采用 command-line imperative while(true) 循环 + AgentEventEmitter，与主流保持一致。

---

## 2. Agent Loop 具体代码对比

### ClaudeCode（1729 行 AsyncGenerator）
```typescript
async function* queryLoop(params): AsyncGenerator<Message, Terminal> {
  let state = { messages, toolUseContext, ... }
  while (true) {
    messagesForQuery = await applyCompaction(messages)
    for await (const msg of deps.callModel({ messages: messagesForQuery })) {
      yield msg
      if (msg.type === 'assistant') { toolUseBlocks.push(...extractToolUses(msg)) }
    }
    if (!needsFollowUp) { /* error recovery */ return { reason: 'completed' } }
    for await (const update of runTools(toolUseBlocks)) { yield update.message }
    state = { messages: [...messages, ...assistantMessages, ...toolResults] }
  }
}
```

### OpenHarness（~200 行 imperative）
```python
while True:
    response = await api.stream(messages, tools)
    if response.stop_reason != "tool_use":
        break
    for tool_call in response.tool_uses:
        # Permission check → Hook → Execute → Hook → Result
        result = await harness.execute_tool(tool_call)
    messages.append(tool_results)
```

### DeepAgents（LangGraph 编译图）
```python
# LangGraph 状态图编译后隐式执行 while 循环
agent = create_deep_agent()
result = agent.invoke({"messages": [{"role": "user", "content": "Research LangGraph"}]})
# 内部：state graph 自动处理 tool_use → tool_execute → llm_call 循环
```

### AgentScope（ReActAgent `__call__`）
```python
async def __call__(self, msg: Msg | None = None) -> Msg:
    # 内部 while 循环 + ReAct 提示词 + 工具调用
    msg = await agent(msg)  # 单次 ReAct 循环
```

**结论**：AgentForge 新架构 `async function while(true)` 与 ClaudeCode、OpenHarness、AgentScope 的循环模式完全对齐。DeepAgents 用 LangGraph 做 graph-based 循环，也是 imperative 的——graph 编译后就是状态机驱动的 while 循环。

---

## 3. Hook / 插件 / 切面系统对比

| 框架 | Hook 机制 | 粒度 | 签名 |
|------|----------|------|------|
| **ClaudeCode** | 无 Hook 系统 — 内联代码 | N/A | N/A |
| **OpenCode** | `Hooks` 接口，16 个切面 | event/chat.message/chat.params/tool.execute.before/after | `(input, output) => Promise<void>` |
| **OpenHarness** | PreToolUse/PostToolUse hooks | tool.execute 前后 | `hook(input) -> result` |
| **DeepAgents** | middleware + callbacks | graph node 级 | LangGraph 回调 |
| **Mastra** | middleware | agent/workflow step 级 | `(context, next) => ...` |
| **AgentScope** | 无独立 Hook — callback 注入 | agent/memory/model 级 | 各模块独立 |
| **AgentForge** | Plugin（Interceptor + Observer） | 事件级（40+ types） | `intercept(event): Promise<AgentEvent>` |
| **AgentForge (新)** | HookRegistry 12 切面 + RequestHook + ToolHook | llm.request/response + tool.execute + session lifecycle | `(input, output) => Promise<void>` |

**结论**：AgentForge 新 Hook 系统（12 生命周期切面 + RequestHook + ToolHook）与 OpenCode 的 16 切面模型最接近，但比 OpenCode 多一个 RequestHook（修改 LLM 前消息）和 ToolHook（执行前检查）。比 OpenHarness 的 PreToolUse/PostToolUse 覆盖更广——OpenHarness 只在工具执行周围有 hook，没有 LLM 请求/响应 hook。比 ClaudeCode 多了一个完整的 hook 系统（ClaudeCode 没有）。

---

## 4. 可观测性 / 可恢复性对比

| 能力 | ClaudeCode | OpenCode | OpenHarness | DeepAgents | Mastra | AgentScope | **AgentForge 新** |
|------|-----------|----------|-------------|------------|--------|-----------|-------------------|
| **事件流** | AsyncGenerator yield | Effect Stream | 无统一流 | LangGraph stream | graph stream | 无统一流 | AgentEventEmitter (typed) |
| **Token 预算** | ✅ BudgetTracker | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (21-TOKEN-BUDGET) |
| **错误恢复** | ✅ 分级恢复 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (22-ERROR-RECOVERY) |
| **工具并发安全** | ✅ isConcurrencySafe | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (23-TOOL-CONCURRENCY) |
| **可中断** | AbortController | Effect fiber cancel | ❌ | LangGraph interrupt | ❌ | ❌ | AbortController (真正杀连接) |
| **可审核** | GrowthBook telemetry | Effect telemetry | ❌ | LangSmith traces | built-in OTEL | OTel | AuditLogger + hook audit |
| **MPU 模块** | ❌ | ❌ | ❌ | ❌ | Enterprise (ee/) | ❌ | ✅ 10 MPU 独立模块 |

**结论**：AgentForge 是唯一一个同时具备 Token 预算、错误恢复、工具并发安全三项能力的框架。这三项能力来自 ClaudeCode 的直接借鉴。在可审核/可观测方面，Mastra 和 AgentScope 有更成熟的 OTEL 集成——这是 AgentForge 的潜在短板。

---

## 5. AgentForge 特有的价值（对比后确认）

| 独有能力 | 为什么独特 | 来源 |
|---------|-----------|------|
| **MPU 模块化** (10 独立模块) | 其他框架将 sandbox/audit/security 内联在核心代码中，AgentForge 作为独立模块外挂 | 原创 |
| **三层 API** (L1 零代码 / L2 配置式 / L3 编程式) | Mastra 有 L2，AgentScope 有 L1+L2，但无人有完整三层 | 原创 |
| **Token 预算 + 递减收益** | ClaudeCode 有但其他框架没有。AgentForge 借鉴并适配到 hook 系统 | ClaudeCode |
| **分级错误恢复** | ClaudeCode 有但其他框架没有。AgentForge 做了同样的事 | ClaudeCode |
| **Per-tool 并发安全** | ClaudeCode 独创，AgentForge 借鉴。其他框架要么全串行要么全并行 | ClaudeCode |
| **Hook 系统覆盖 LLM 请求/响应** | OpenCode 有 chat.message/chat.params 但不完全等价。OpenHarness 只有 tool hook | OpenCode + 原创扩展 |

---

## 6. AgentForge 的短板（对比后确认）

| 短板 | 谁做得更好 | 建议 |
|------|-----------|------|
| **图 Workflow（.then/.branch/.parallel）** | Mastra 的 graph engine 是标杆 | AgentForge 的 SequentialPipeline/ParallelPipeline 足够用，不是高优先级 |
| **OTEL 集成** | AgentScope 内置 OTel；Mastra 有 built-in observability | AgentForge 有 ConsoleTracer/ConsoleMetrics 但缺 OTel exporter。P2 |
| **Eval 框架** | Mastra 有 built-in evals；AgentScope 有 ACEBench | AgentForge 缺 eval 系统。P3 |
| **部署/服务化** | AgentScope 有 serverless + K8s；Mastra 有 standalone server | AgentForge 缺。P3 |
| **Memory 系统** | Mastra 有 working/semantic memory；AgentScope 有 short/long-term + compression | AgentForge 有 CompactionManager + FileBasedMemory，中等 |
| **CLI 体验** | ClaudeCode、OpenHarness、DeepAgents 都有生产级 CLI | AgentForge 有基础 CLI (`create-agentforge`)，不是优先 |

---

## 7. 与 OpenHarness 的直接对比（最接近的参考对象）

OpenHarness 是唯一一个明确自称 "Agent Harness" 的项目，且用 Python `while True` imperative 循环 + PreToolUse/PostToolUse hook。AgentForge 与它的架构方向完全一致，但有几点关键的差异：

| 维度 | OpenHarness | AgentForge (新) |
|------|------------|-----------------|
| 循环 | `while True: await api.stream()` | 完全相同的 imperative 模式 |
| Hook | PreToolUse / PostToolUse（2 切面） | 12 切面（session/step/llm/tool/compaction） |
| Hook 能力 | 只能观察/拒绝工具 | 可修改消息、可修改工具参数、可拒绝执行 |
| 插件兼容 | claude-code plugin 格式兼容 | 自定义 Plugin 接口 |
| 类型安全 | Pydantic（Python） | Zod + TypeScript strict: true |
| 测试 | 114 tests | 345 tests |
| 语言 | Python | TypeScript |
| 多 agent | Subagent spawning + Team Registry | SubagentRegistry（类似） |
| Token 预算 | ❌ | ✅ 递减收益检测 |
| 错误恢复 | ❌ | ✅ 分级恢复 + fallback 模型 |

**AgentForge 在 Hook 覆盖面上超过 OpenHarness，在三个借鉴自 ClaudeCode 的工程能力上超过所有对比框架。**

---

## 8. 总结

```
                    Agent Loop 模型
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
  imperative          graph-based          imperative
    │                    │                    │
  ClaudeCode ✓       DeepAgents           AgentForge ✓
  OpenHarness ✓      Mastra Workflow
  AgentScope ✓
```

AgentForge 的架构方向——imperative 循环 + Hook 切面——在行业中**不是特立独行，而是回归主流**。ClaudeCode、OpenHarness、AgentScope 都用了同样的模式并证明了它的可行性。

AgentForge 的差异化在于：
1. **借鉴 ClaudeCode 但超越 ClaudeCode**：Token 预算、错误恢复、并发安全三项 ClaudeCode 独有的工程能力被提取并 Hook 化
2. **借鉴 OpenCode 但覆盖更广**：Hook 系统从 OpenCode 的 `(input, output) => Promise<void>` 模式出发，扩展到 LLM 请求前（RequestHook）和工具执行前（ToolHook）
3. **TypeScript 原生**：与 Mastra 同语言但不依赖外部流引擎，零依赖 Agent Loop
4. **MPU 模块化**：10 个独立模块可外挂可替换，这是所有对比框架中独有的
