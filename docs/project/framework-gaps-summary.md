# AgentForge 模块差距总结

> 基于 AgentScope, DeepAgents, Mastra 框架对比分析
> 更新时间：2026-04-29 — 基于代码审计修正（第三轮）

---

## P0 - 核心缺失 (全部已完成 ✅)

| 模块 | 当前状态 | 行动项 |
|------|---------|--------|
| **LLM Adapter** | ✅ AI SDK v6 完整实现 | ~~实现 `OpenAIAdapter`~~ 已完成 |
| **MCP Client** | ✅ 完整接入 | ~~实现 `StdIOMCPClient`~~ 已完成 |
| **Git Hooks** | ✅ Husky + lint-staged | 已完成 |

---

## P1 - 多 Agent 协作 (全部已完成 ✅)

| 模块 | 当前状态 | 参考实现 |
|------|---------|---------|
| **SubAgent** | ✅ 已实现（orchestrator + transparent expand passthrough） | DeepAgents `SubAgentMiddleware` + `task` tool |
| **MsgHub** | ❌ 不适用 — A2A broadcast + RxJS Subject 已覆盖 | AgentScope `MsgHub` + auto-broadcast |
| **Pipeline** | ✅ 已实现（SequentialPipeline, ParallelPipeline） | AgentScope `SequentialPipeline` / Mastra `Workflow.then()` |

---

## P2 - 生产力增强

| 模块 | 当前状态 | 参考实现 |
|------|---------|---------|
| **Planning** | ✅ fire-and-forget (Phase 1) | DeepAgents `TodoListMiddleware` + `write_todos`（Phase 2: 注入 AgentState 待实现） |
| **Filesystem** | ❌ | DeepAgents `FilesystemBackend` |
| **Summarization** | 事件定义 | DeepAgents 85% threshold auto-compaction |

---

## P3 - 可观测性 (默认实现已完成 ✅)

| 模块 | 当前状态 | 参考实现 |
|------|---------|---------|
| **Tracer** | ✅ NoopTracer + ConsoleTracer 默认实现 | Mastra `DefaultExporter` + OTel exporters |
| **Metrics** | ✅ NoopMetrics + ConsoleMetrics + BridgeMetrics(MPU) 默认实现 | AgentScope Studio / Mastra CloudExporter |
| **Preset-Service Wiring** | ✅ createAgent() 正确消费 tracing/metrics 配置 | Mastra `development` preset |
| **Development Preset** | ✅ ConsoleTracer + ConsoleMetrics + developmentPreset operator | Mastra `development` preset |

---

## 详细报告

完整对比分析见: `docs/analysis/analysis_agentforge_gap.md`

---

## 快速参考: 各框架核心模式

```
AgentScope:  MsgHub + Hooks + TypedDict
DeepAgents:  Middleware + Backend Protocol + 85% Summarization
Mastra:      Processor + DynamicArgument + Composite Storage
AgentForge:  Observable<AgentEvent> + expand + errors-as-events
```

## 实施优先级

```
Week 1-2: P0 ✅ 已完成（LLM Adapter + MCP Client + Git Hooks）
Week 3-5: P1 ✅ 已完成（SubAgent + Pipeline）
Week 6-7: P2 (Planning Phase 2 + Filesystem + Summarization)
Week 8:   P3 ✅ 默认实现完成（Tracer + Metrics — 完整 OTel 属于生态层，不做）
```
