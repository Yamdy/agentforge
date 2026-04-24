# 架构总览

> AgentForge 事件流架构的完整架构图、迁移路径和实施路线图。

---

## 架构总览图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AgentForge 事件流架构                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                   L1: 零代码 (配置文件)                            │ │
│  │   agentforge.config.md → createAgent(config) → agent.run()         │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │                   L2: 配置式 (推荐)                                │ │
│  │   createAgent(config) → agent.run() / agent.stream()              │ │
│  │   配置驱动 DI：自动解析 LLM/Tools/Checkpoint/Tracing/MCP          │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │                   L3: 编程式 (RxJS)                                │ │
│  │   agent.run$(input).pipe(timeout(), retry(), tap()).subscribe()   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                       操作符层 (可插拔)                             │ │
│  │                                                                     │ │
│  │  控制流: timeout, retry, takeUntil, requirePermission              │ │
│  │  变换:   transformLLMParams, transformToolArgs, compressMessages   │ │
│  │  通知:   logEvents, traceEvents, recordMetrics, exportEvents       │ │
│  │  组合:   productionPreset, debugPreset                              │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      Agent Loop (expand)                            │ │
│  │                                                                     │ │
│  │   Observable<AgentEvent>                                            │ │
│  │       │                                                             │ │
│  │       └─ expand(事件 → 下一步事件流)                                │ │
│  │            │                                                        │ │
│  │            ├─ agent.start → llm.request                            │ │
│  │            ├─ llm.request → llm.stream.* → llm.response            │ │
│  │            ├─ llm.response → tool.call[] 或 done                   │ │
│  │            ├─ tool.call → 本地工具 / Subagent / MCP                │ │
│  │            │         ├─ 本地 → tool.execute → tool.result           │ │
│  │            │         ├─ Subagent → subagent.* → 嵌套流冒泡          │ │
│  │            │         └─ MCP → mcp.callTool → tool.result            │ │
│  │            ├─ tool.result → llm.request (循环)                     │ │
│  │            ├─ hitl.ask → 等待 hitl.answer (暂停)                   │ │
│  │            └─ done → EMPTY (终止)                                   │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                   轻量 DI (AgentContext)                            │ │
│  │                                                                     │ │
│  │   配置驱动装配: createAgent(config) → ContextBuilder → AgentContext │ │
│  │   编程式组装:   ContextBuilder.create().withLLM().build()          │ │
│  │   测试 Mock:    ContextBuilder + Mock 接口                          │ │
│  │                                                                     │ │
│  │   Context 通过闭包传入事件流处理器（不在事件载荷中）               │ │
│  │                                                                     │ │
│  │   必填: llm, tools                                                  │ │
│  │   可选: checkpoint, hitl, tracer, metrics, mcp, subagents          │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                   │                                      │
│                                   ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                      事件流底座 (RxJS + Zod)                       │ │
│  │                                                                     │ │
│  │   Observable<AgentEvent> + Zod discriminatedUnion 验证            │ │
│  │                                                                     │ │
│  │   Layer 1: 核心 Agent Loop (18 种事件)                             │ │
│  │   Layer 2: 子系统生命周期 (15 种事件)                              │ │
│  │   Layer 3: 横切关注点 (7 种事件)                                   │ │
│  │   总计: 40 种类型安全事件                                           │ │
│  │                                                                     │ │
│  │   特性:                                                             │ │
│  │   - 可观测: subscribe()                                             │ │
│  │   - 可中断: takeUntil(), unsubscribe()                              │ │
│  │   - 可恢复: Checkpoint + resumeAgent()                              │ │
│  │   - 重试:   retry()                                                 │ │
│  │   - 超时:   timeout()                                               │ │
│  │   - 打点:   tap()                                                   │ │
│  │   - HITL:   Subject + resume()                                      │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 迁移路径

| 现有机制 | 迁移到 |
|---------|--------|
| Stream Middleware | 直接用 `pipe()` 替换 |
| Lifecycle Middleware | 用 `retryOnEventType()` 或自定义操作符 |
| Plugin Hooks (output 修改) | 用 `transformToolArgs()` 等变换操作符 |
| Plugin Hooks (纯通知) | 用 `tap()` 通知操作符 |
| Checkpoint | 用 `checkpoint()` 操作符 |

---

## 实施路线图

### Phase 1: 核心类型 (1 周)

```
src/core/
├── events.ts          # 40 种事件类型 (Zod discriminatedUnion)
├── state.ts           # AgentState Schema
├── checkpoint.ts      # Checkpoint Schema
├── context.ts         # AgentContext Schema + 接口定义
└── context-builder.ts # ContextBuilder
```

### Phase 2: Agent Core (1.5 周)

```
src/core/
├── agent.ts           # Agent 类 + run/run$/stream 方法
├── handlers/          # 事件处理器
│   ├── llm.ts         # LLM 请求/响应处理
│   ├── tool.ts        # 工具执行处理（含嵌套流）
│   └── hitl.ts        # HITL 处理
└── state-manager.ts   # 状态不可变更新
```

### Phase 3: 操作符库 (1 周)

```
src/operators/
├── control.ts         # timeout, retry, requirePermission
├── transform.ts       # transformLLMParams, transformToolArgs
├── notify.ts          # logEvents, traceEvents, recordMetrics
└── presets.ts         # productionPreset, debugPreset
```

### Phase 4: DI + 工厂 (0.5 周)

```
src/core/
├── config.ts          # AgentConfig Schema + createAgent()
├── factory/           # 工厂函数
│   ├── llm.ts         # createLLMAdapter
│   ├── storage.ts     # createCheckpointStorage
│   └── tracing.ts     # createTracer
└── index.ts           # 公共 API 导出
```

### Phase 5: 子系统适配 (1 周)

```
src/subsystems/
├── mcp/               # MCP 适配层
├── subagent/          # Subagent 适配层
└── workflow/          # Workflow 适配层
```

---

## 版本信息

- **设计日期**: 2026-04-24
- **状态**: 设计稿
- **版本**: v3 (添加流层陷阱与约束：生命周期/竞态/错误边界)

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约层
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [04-PROMPT-BUILDER.md](./04-PROMPT-BUILDER.md) - Prompt 构建
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
