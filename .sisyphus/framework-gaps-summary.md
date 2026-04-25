# AgentForge 模块差距总结

> 基于 AgentScope, DeepAgents, Mastra 框架对比分析

---

## P0 - 核心缺失 (立即实现)

| 模块 | 当前状态 | 行动项 |
|------|---------|--------|
| **LLM Adapter** | Mock only | 实现 `OpenAIAdapter` 使用 `@ai-sdk/openai-compatible` |
| **MCP Client** | 接口定义 | 实现 `StdIOMCPClient` |
| **Git Hooks** | ❌ | 添加 Husky + lint-staged |

---

## P1 - 多 Agent 协作 (重要)

| 模块 | 当前状态 | 参考实现 |
|------|---------|---------|
| **SubAgent** | 接口定义 | DeepAgents `SubAgentMiddleware` + `task` tool |
| **MsgHub** | ❌ | AgentScope `MsgHub` + auto-broadcast |
| **Pipeline** | ❌ | AgentScope `SequentialPipeline` / Mastra `Workflow.then()` |

---

## P2 - 生产力增强

| 模块 | 当前状态 | 参考实现 |
|------|---------|---------|
| **Planning** | ❌ | DeepAgents `TodoListMiddleware` + `write_todos` |
| **Filesystem** | ❌ | DeepAgents `FilesystemBackend` |
| **Summarization** | 事件定义 | DeepAgents 85% threshold auto-compaction |

---

## P3 - 可观测性

| 模块 | 当前状态 | 参考实现 |
|------|---------|---------|
| **OTel** | 接口定义 | Mastra `Span` + exporters |
| **Metrics** | 接口定义 | AgentScope Studio / Mastra CloudExporter |

---

## 详细报告

完整对比分析见: `docs/framework-comparison-analysis.md`

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
Week 1-2: P0 (LLM Adapter + MCP Client + Git Hooks)
Week 3-5: P1 (SubAgent + MsgHub + Pipeline)
Week 6-7: P2 (Planning + Filesystem + Summarization)
Week 8:   P3 (OTel + Metrics)
```
