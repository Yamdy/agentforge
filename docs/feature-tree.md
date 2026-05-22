# AgentForge 特性树（Feature Tree）

> 基于华为云特性树/SF 方法论，从客户价值视角梳理产品全量特性。
> SF（系统特性）→ IR（初始需求/能力域）→ US（用户故事/功能点）三层结构。
> 创建日期：2026-05-20

---

## 特性树总览

```
AgentForge 特性树
├── SF-1  Agent Pipeline Engine     ████████████ 核心
├── SF-2  LLM Integration           ████████████ 核心
├── SF-3  Tool System                ██████████   核心
├── SF-4  Multi-Agent Orchestration  ████████     新增
├── SF-5  Observability & Harness    ████████████ 核心
├── SF-6  Session & Persistence      █████████    核心
├── SF-7  Plugin System              ████████████ 核心
├── SF-8  Configuration & Profiles   ███████      支撑
├── SF-9  Server & Deployment        ████████     产品化
├── SF-10 Task Management            ██████       新增
└── SF-11 State Management           ████         支撑
```

---

## 包依赖关系

```
sdk (零依赖，纯类型)
  ← tools         (工具实现)
  ← observability (可观测抽象)
  ← core          (全部运行时：管道/Agent/LLM/会话/编排/任务队列)
  ← plugins       (处理器插件)
  ← server        (HTTP 服务 + A2A + 认证)
```

---

## SF-1: Agent Pipeline Engine — 智能体管道引擎

> **客户价值**：开发者可通过声明式管道编排 Agent 的完整生命周期，每个阶段既是业务逻辑执行点、也是可观测性埋点、也是拦截扩展点。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-1.1 | Pipeline Runner | 10 阶段管道按序执行，支持 preLoop/loop/postLoop 三段编排 | `core/pipeline.ts` |
| IR-1.2 | Context Builder | 4-region 上下文装配（request/agent/iteration/session），Dynamic&lt;T&gt; 运行时解析 | `core/context-builder.ts` |
| IR-1.3 | Processor System | 8 个内置处理器（processInput→…→processOutput），no-op 扩展点 + 实质性处理器工厂 | `core/processors/*.ts` |
| IR-1.4 | Control Flow | abort/retry/suspend/error 四种控制流，ProcessorControl API v2 | `core/control-flow.ts` |
| IR-1.5 | Loop Orchestrator | agentic loop 编排，共享 run/stream 逻辑，含 step cap/token cap 检查 | `core/loop-orchestrator.ts` |
| IR-1.6 | Adapters | 高级 Processor API：modifiers（消息/系统提示/工具注入）、gates（权限/配额/成本门控） | `core/adapters/` |

### Pipeline 10 阶段

```
processInput → buildContext → [Agentic Loop:
  prepareStep → gateLLM → invokeLLM → processStepOutput → gateTool → executeTools → evaluateIteration
] → processOutput
```

### 4-Region Context 模型

| Region | 职责 | 关键字段 |
|--------|------|---------|
| `request` | 不可变输入 | input, sessionId |
| `agent` | 配置 + 提示 + 工具声明 | config, systemPrompt, toolDeclarations, promptFragments, providerOptions |
| `iteration` | 单步状态 | step, loopDirective, content, response, tokenUsage, pendingToolCalls, toolResults, span |
| `session` | 跨步状态 | messageHistory, totalTokenUsage, custom（插件扩展） |

---

## SF-2: LLM Integration — 大模型集成

> **客户价值**：一套统一的模型调用层，适配多家 LLM 提供商，内置容错和兼容性处理。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-2.1 | LLM Invoker | 基于 ai.streamText() 的流式 LLM 调用，支持 reasoning 提取 | `core/llm-invoker.ts` |
| IR-2.2 | Model Factory | 单一规范模型解析路径，parseModel() 消除循环依赖 | `core/model-factory.ts`, `parse-model.ts` |
| IR-2.3 | Gateway Chain | 可插拔模型网关：BuiltInGateway + OpenAICompatibleGateway，注册顺序优先匹配 | `core/gateways/` |
| IR-2.4 | Provider Compat | ProviderCapabilities 检测 + CompatRule 引擎（preemptive/reactive 双模式） | `core/provider-capabilities.ts`, `processors/provider-history-compat.ts` |
| IR-2.5 | Retry & Fallback | streamWithRetry 初始连接重试 + FallbackRunner 多模型降级链 | `core/retry.ts`, `core/fallback-runner.ts` |

### 支持的 Provider

- OpenAI (@ai-sdk/openai)
- Anthropic (@ai-sdk/anthropic)
- Google (@ai-sdk/google)
- DeepSeek (@ai-sdk/openai compatible)
- 任意 OpenAI Compatible API (@ai-sdk/openai-compatible)

### CompatRule 双模式

| 模式 | 时机 | 作用 |
|------|------|------|
| Preemptive | LLM 调用前 | 重写 AI SDK 消息格式，不修改持久化历史 |
| Reactive | API 错误后 | 修复持久化历史，重试调用 |

---

## SF-3: Tool System — 工具系统

> **客户价值**：Agent 可调用丰富的内置工具和自定义工具，通过 MCP 协议连接外部能力。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-3.1 | Tool Registry | 工具注册/注销，toAiSdkToolSchemas() 转换，before/after hooks | `core/tool-registry.ts` |
| IR-3.2 | Built-in Tools | 16 个内置工具，5 类，支持 exclude/only 筛选注册 | `tools/*.ts` |
| IR-3.3 | MCP Integration | MCP 客户端/管理器/工具转换器，支持 stdio/sse/http 三种传输协议 | `plugins/mcp/` |
| IR-3.4 | Sub-Agent Tool | 子 Agent 作为工具调用，支持 isolated/inherit/summary-only 三种上下文策略 | `core/sub-agent.ts` |

### 内置工具分类

| 类别 | 工具 |
|------|------|
| file | fileRead, fileWrite, fileEdit, glob, grep |
| web | http, webSearch, webFetch |
| system | shell, datetime |
| utility | calculator, json, echo |
| memory | memoryStore, memoryRetrieve, memoryList |

---

## SF-4: Multi-Agent Orchestration — 多智能体编排

> **客户价值**：多个 Agent 可按顺序、并行或路由模式协同工作，构建复杂的多智能体工作流。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-4.1 | Sequential Executor | 顺序执行多个 Agent，上一步输出作为下一步输入 | `core/orchestration/executors/sequential.ts` |
| IR-4.2 | Parallel Executor | 并行执行多个 Agent，支持聚合函数和 fail-fast/continue 容错策略 | `core/orchestration/executors/parallel.ts` |
| IR-4.3 | Agent Router | 基于 classifier 的动态路由，匹配输入到指定 Agent | `core/orchestration/executors/router.ts` |
| IR-4.4 | Orchestration Pipeline | 声明式编排管道，混搭 sequential/parallel/router 步骤 | `core/orchestration/pipeline.ts` |

### 编排模式

```
Sequential: Agent A → Agent B → Agent C（链式）
Parallel:   Agent A ─┐
            Agent B ─┤→ Aggregator → Output
            Agent C ─┘
Router:     Input → Classifier → {Agent A | Agent B | Agent C} → Output
```

---

## SF-5: Observability & Harness — 可观测性与管控

> **客户价值**：生产级 Agent 运行需要观测、控制和干预能力，Harness 三形态（observe/control/intervene）覆盖全场景。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-5.1 | Event System | EventBus 发布订阅 + ReplayBackend 事件回放 + REPLAY_SENTINEL | `core/event-system.ts`, `core/event-bus.ts` |
| IR-5.2 | Hook Manager | 9 个拦截点，优先级排序，minimal/standard/strict 三档 | `core/hook-manager.ts` |
| IR-5.3 | Span/Tracer/Metrics | SpanImpl 树形链路 + InMemoryMetrics + OTelBridge OTel 桥接 + TraceCollector | `observability/` |
| IR-5.7 | OTLP Export | SafeOtlpSpanExporter 安全导出 + createOtlpTracerProvider 工厂，环境变量配置，优雅降级 | `observability/otel-exporter.ts` |
| IR-5.4 | Harness Gates | Cost Cap / Token Budget / Rate Limit / Required Tools Gate 四类内置门控 | `plugins/harness/` |
| IR-5.5 | Goal Echo & Fact Injection | 目标回声（防止 Agent 漂移）+ 事实注入（上下文增强） | `plugins/harness/` |
| IR-5.6 | Output Validation | 输出校验策略（json-schema/regex/custom），block/warn/fix 三种处理模式 | `plugins/validation/` |

### Hook 拦截点

| Hook Point | 触发时机 |
|------------|---------|
| agent.start / agent.end | Agent run 开始/结束 |
| stage.before / stage.after | 管道阶段执行前/后 |
| llm.before / llm.after | LLM 调用前/后 |
| tool.before / tool.after | 工具执行前/后 |
| iteration.end | 单次迭代结束 |
| error | 错误发生时 |

### AOP 三方法映射

| 方法 | 机制 | 代码 |
|------|------|------|
| Method 1: Callback/Hook | 固定位置拦截 | HookManager, tool before/after hooks |
| Method 2: Flow as Data | 可配置管道阶段 | LoopOrchestrator stage arrays + PipelineStageConfig |
| Method 3: Side Observing | 非侵入事件发射 | EventSystem (emit + replay) |

### OTLP 导出配置

通过环境变量配置 OTLP HTTP 导出，支持 Jaeger、Zipkin、Grafana Tempo 等 OTLP 兼容后端：

```bash
# 必填：OTLP 端点
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# 可选：服务名称（默认 agentforge）
OTEL_SERVICE_NAME=my-agent-service

# 可选：禁用 OTel SDK
OTEL_SDK_DISABLED=false
```

**特性**：
- 优雅降级：未配置端点时静默禁用，不影响主流程
- 安全导出：网络错误不抛异常，返回失败状态
- 批量发送：BatchSpanProcessor 默认 5s 间隔，512 条批量

---

## SF-6: Session & Persistence — 会话与持久化

> **客户价值**：Agent 对话可持久化、可恢复、可回溯，支持 HITL（人机协作）工作流。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-6.1 | Session Manager | 完整生命周期管理（start/restore/suspend/resume/list），11 种事件类型 | `core/session-manager.ts` |
| IR-6.2 | Session Storage | File（JSONL）+ SQLite 双存储后端，树形分支 via parentSessionId | `core/session-storage.ts`, `session-storage-sqlite.ts` |
| IR-6.3 | Checkpoint Store | InMemory + JSONL 两种 Checkpoint 存储，用于 suspend/resume | `core/checkpoint-store.ts` |
| IR-6.4 | Serialization | PipelineContext 序列化/反序列化，支持跨进程 checkpoint 传递 | `core/serialize.ts` |
| IR-6.5 | Sync Event | 事件同步存储，VersionMismatchError 冲突检测 | `core/sync-event.ts` |

### Session 状态

```
active → completed
active → suspended → active (resume)
active → cancelled
active → error
```

### 11 种 Session 事件类型

session.created, user.message, assistant.message, tool.call, tool.result, iteration.complete, agent.completed, agent.aborted, agent.suspended, agent.error, checkpoint.saved

---

## SF-7: Plugin System — 插件系统

> **客户价值**：框架所有能力可通过插件扩展，Plugin 是 Processor/Tool/Hook/Resource 的统一注册入口。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-7.1 | Plugin Manager | 工厂模式注册，获取 HarnessAPI 注入依赖 | `core/plugin-manager.ts` |
| IR-7.2 | Harness API | 5 子接口组合：PipelineRegistry + ToolRegistryAPI + InterceptionAPI + StageMutationAPI + LifecycleAPI | `sdk/` HarnessAPI 接口 |
| IR-7.3 | Memory Plugin | InMemory + SQLite 后端，触发模式配置，去重/纠正/跨会话修正 | `plugins/memory/` |
| IR-7.4 | Compression Plugin | 滑动窗口 + 自定义策略 + LLM 摘要压缩，Token 预算控制 | `plugins/compression/` |
| IR-7.5 | Permission Plugin | 规则引擎 + allow/deny/ask 三模式 + glob 匹配 + 内置危险工具列表 | `plugins/permission/` |
| IR-7.6 | Skill Plugin | 文件系统技能发现 + YAML frontmatter 解析 + 渐进式披露 | `plugins/skill/` |
| IR-7.7 | Eviction Plugin | 大内容驱逐到外部存储（InMemory/Filesystem），返回 preview + reference | `plugins/eviction/` |

### Plugin 注册内容

- processors: 管道处理器数组
- tools: 工具定义数组
- commands: 命令映射
- compressionStrategy: 压缩策略

---

## SF-8: Configuration & Profiles — 配置与预设

> **客户价值**：多层配置合并 + 动态解析 + 预设模板，满足从简单到复杂的全部配置场景。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-8.1 | Multi-level Config | 4 层 JSONC 配置合并（session → project → global → env） | `core/config-merge.ts`, `core/config.ts` |
| IR-8.2 | Dynamic Resolution | Dynamic&lt;T&gt; 类型，字段可声明为函数在每次请求时动态解析 | `core/dynamic-resolver.ts` |
| IR-8.3 | Agent Presets | 3 个内置预设（executor/planner/researcher），可扩展注册自定义预设 | `core/presets/` |
| IR-8.4 | Model Profile | 按模型 pattern 匹配，自动追加 systemPromptSuffix/toolOverrides/promptFragments | `core/model-profile.ts` |

### 配置优先级（高→低）

1. Session-level — agent.run() 运行时参数
2. Project-level — .agentforge/config.jsonc
3. Global-level — ~/.agentforge/config.jsonc
4. Environment — AGENTFORGE_CONFIG 环境变量

---

## SF-9: Server & Deployment — 服务化部署

> **客户价值**：AgentForge Agent 可直接作为 HTTP 服务部署，支持 SSE 流式输出和 A2A 协议互联。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-9.1 | AgentForge Server | HTTP/SSE 服务，Agent 注册路由，流式事件推送 | `server/server.ts` |
| IR-9.2 | Agent Registry | 多 Agent 注册中心，按 ID 路由请求 | `server/registry.ts` |
| IR-9.3 | A2A Protocol | Agent-to-Agent 协议（AgentCard/Task/Artifact），JSON-RPC 传输，流式推送 | `server/a2a/` |
| IR-9.4 | Client SDK | AgentForgeClient，SSE 解析，connect/run/stream 三种调用模式 | `sdk/client.ts` |
| IR-9.5 | Authentication | AuthAdapter 接口 + StaticKeyAuthAdapter 实现 | `server/middleware/` |
| IR-9.6 | Studio Observability | Studio UI 可观测性集成 | `server/studio/` |
| IR-9.7 | Server Profiles | 4 种服务端预设（coding/business/personal/data） | `server/profiles/` |

---

## SF-10: Task Management — 任务管理

> **客户价值**：长时间运行的 Agent 任务可排队、并发控制、自动检查点恢复。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-10.1 | Task Queue | enqueue/getStatus/cancel/resume/list 完整生命周期，优先级排序 | `core/task-queue/queue.ts` |
| IR-10.2 | Concurrency Control | 可命名并发槽，maxConcurrent 限制，acquire/release + timeout | `core/concurrency-controller.ts` |
| IR-10.3 | Task Notification | 任务事件通知管理（progress/complete/error/suspend） | `core/task-queue/notification.ts` |
| IR-10.4 | Auto Checkpoint | 定时自动检查点插件 | `core/task-queue/checkpoint-plugin.ts` |
| IR-10.5 | Task Manager | 异步子 Agent 任务启动/查询/取消，FallbackModel 降级 | `core/task-manager.ts` |

---

## SF-11: State Management — 状态管理

> **客户价值**：Agent 生命周期状态可追踪、可控制，终端状态支持重置复用。

| IR | 能力域 | 功能点 | 对应代码 |
|----|--------|--------|---------|
| IR-11.1 | State Machine | 6 种状态，终端状态可 reset | `core/state-machine.ts` |
| IR-11.2 | Agent Facade | Agent 类作为薄门面，construct → register → delegate 三步，支持多次 run() | `core/agent.ts` |

### 状态机转换

```
pending → running → completed
                  → paused → running (resume)
                  → cancelled
                  → error → pending (reset)

终端状态（completed/cancelled/error）→ pending (reset，支持多次 run)
```

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-05-20 | 初始版本，11 SF / 44 IR 全量梳理 |


## P2 生产级能力 (2026-05)

### 可观测性
- **OTel Metrics Bridge** — 双路径 Metrics 导出（InMemory + OTLP），无 MeterProvider 优雅降级
- **W3C Trace Context 传播** — traceparent extract/inject，跨服务链路关联
- **Trace 采样策略** — always_on/always_off/ratio，环境变量或代码级配置
- **Agent 自动 OTel** — 零配置检测 OTEL_EXPORTER_OTLP_ENDPOINT 自动导出

### Server 生产化
- **HTTP 限流中间件** — 滑动窗口，IP+路由级别，标准 RateLimit 响应头
- **结构化日志** — JSON/pretty/silent 格式，X-Request-Id 自动生成/透传
- **Config 环境变量展开** —  和  语法

### 数据韧性
- **事件完整性校验** — SHA-256 checksum 每行事件，verifyIntegrity() 审计
- **Snapshot 内容恢复** — revert 完整恢复被修改/删除的文件
- **Session TTL 自动清理** — 过期会话自动 GC
- **序列化版本控制** — version 字段 + 迁移钩子

### 事件系统增强
- **EventBus async emit** — emitAsync 并行事件发送，Promise.allSettled
- **CompositeHook** — parallel/sequential/first-wins 组合模式
