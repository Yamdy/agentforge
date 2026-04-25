# 端侧 Agent 开发框架需求、设计与 AgentForge 差距分析

日期：2026-04-23

## 1. 研究范围

本报告基于四个代码仓的源码与文档做对比：

| 仓库 | 本地源码快照 | 语言/定位 | 重点参考价值 |
| --- | --- | --- | --- |
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra) | `e5b4652` | TypeScript Agent 框架/平台化 monorepo | 类型系统、工具构建、工作流、存储域、可观测、评测、Server/Playground/Deployers |
| [agentscope-ai/agentscope](https://github.com/agentscope-ai/agentscope) | `eb7678e` | Python 多 Agent 平台 | 异步 AgentBase、ReAct、MsgHub/Pipeline、RAG/Memory、A2A/MCP、Tracing/Studio |
| [langchain-ai/deepagents](https://github.com/langchain-ai/deepagents) | `291aebe` | Python LangGraph harness | 中间件化深度 Agent、文件系统/权限/内存/子 Agent/HITL、远程异步子 Agent、后端抽象 |
| [Yamdy/agentforge](https://github.com/Yamdy/agentforge) | 本地 `cfbc3ae` | TypeScript 端侧 Agent 框架 | 当前实现基线与差距目标 |

本报告优先回答三个问题：

1. 端侧 Agent 开发框架应具备哪些需求能力。
2. AgentForge 应采用什么设计，既吸收三方优点，又避免过度平台化。
3. 当前 AgentForge 与目标设计之间的差距在哪里，应该按什么优先级补齐。

## 2. 必要性审视

端侧框架和云端 Agent 平台的取舍不同。Mastra 的平台能力非常完整，但完整复制会导致 AgentForge 过重；AgentScope 的科研/多模态/评测能力很全，但 Python 生态中的部分能力不能直接迁移；DeepAgents 的 harness 设计更贴近端侧任务执行，尤其适合作为 AgentForge 的核心参考。

| 能力 | 必要性 | 建议 |
| --- | --- | --- |
| Durable run、checkpoint、resume、tool approval | 5/5 | 立即规划，是端侧长任务稳定运行的底座 |
| 文件系统权限、沙箱、密钥保护、命令执行隔离 | 5/5 | 立即强化，端侧框架的安全边界必须优先 |
| 工具/Skill/MCP/SubAgent 统一调度 | 5/5 | 作为 AgentForge 的核心差异化 |
| Workflow DAG、suspend/resume、并行/分支/循环 | 4/5 | 短期实现可恢复工作流，不必一次做到 Mastra 全量 |
| 记忆压缩、长期记忆、RAG | 4/5 | 短期做轻量本地方案，后续接向量库 |
| OTEL 级可观测、评测 Scorer、回放 | 4/5 | 应成为生产化能力，但晚于核心执行安全 |
| Studio/Playground/可视化管理 | 3/5 | 有价值，但不应早于 CLI/SDK/Server 的稳定 |
| 多部署器、云平台 deployer | 2/5 | 端侧框架暂缓，保留接口即可 |

## 3. 三方框架关键学习

### 3.1 Mastra

Mastra 的源码结构显示它不是单一运行时，而是围绕 Agent、Workflow、Memory、RAG、MCP、Server、Observability、Evals、Storage、Deployers、Playground 组成的平台化 monorepo。`@mastra/core` 的 `Agent` 是强类型泛型类，支持模型、工具、memory、workflow、agents、voice、processors、scorers、browser、requestContextSchema、backgroundTasks 等多维配置。

AgentForge 应吸收：

- 强类型 Agent/Tool/Workflow API，公开 API 不依赖松散 `Record<string, unknown>` 到处透传。
- 工具构建器不只包含 input schema，还要支持 output schema、suspend/resume schema、approval、stream writer、执行上下文。
- Workflow 不应只是内存执行器，应有 runId、snapshot、resume、restart、time travel 的基础模型。
- 存储按领域拆分，至少包括 `sessions`、`runs`、`checkpoints`、`memory`、`artifacts`、`tools`、`workflow_runs`。
- Observability 应贯穿 agent、tool、workflow、MCP、memory、server，而不是只在 Agent 层打简单 span。

AgentForge 不应直接复制：

- 大量 deployer、cloud/workspace/enterprise 分层。
- 过早引入复杂 monorepo 与 playground 生态。
- 复杂 AI SDK 多版本兼容层可以先抽象接口，按真实 provider 需求渐进补齐。

### 3.2 AgentScope

AgentScope 的核心是异步 `AgentBase`，支持 `reply/observe/print/interrupt`，并通过 class-level 与 instance-level hooks 包围 reply、observe、print。`ReActAgent` 把 memory、long-term memory、RAG knowledge、query rewrite、plan notebook、parallel tool calls、structured output、TTS、memory compression 集成在一个可运行闭环里。Pipeline/MsgHub 提供多 Agent 会话广播与顺序/扇出执行。

AgentForge 应吸收：

- `observe` 与 `reply/run` 分离，让 Agent 可以只接收上下文而不立即响应。
- MsgHub/Channel 风格的多 Agent 广播，不把所有多 Agent 都降级成单次 delegate tool。
- Memory 不只是 message history，还要包含 working memory、long-term memory、retrieved knowledge、compressed summary。
- Hooks 要支持 class/global 与 instance/local 两级，且 hook type 应围绕 agent/tool/model/memory/workflow/server 定义清晰。
- ReAct loop 中对结构化输出、工具并行、任务中断、压缩触发的处理应成为运行时能力，而不是业务代码手写。

AgentForge 不应直接复制：

- Python 生态中的模型/多模态/TTS 适配矩阵。
- 面向科研调优/训练的 tuner 能力，短期不适合端侧业务框架核心。

### 3.3 DeepAgents

DeepAgents 的 `create_deep_agent` 是清晰的 harness 入口，它把 TodoList、Skills、Filesystem、SubAgent、Summarization、PatchToolCalls、AsyncSubAgent、ToolExclusion、PromptCaching、Memory、HumanInTheLoop、Permission 组合为有顺序的 middleware stack。它的亮点不是 API 多，而是把端侧任务常见问题抽成中间件：文件系统后端、AGENTS.md memory、权限规则、远程异步子 Agent、任务 ID 管理、检查/更新/取消后台任务、超大 tool result offload。

AgentForge 应吸收：

- 中间件栈必须有明确排序，尤其 Permission/HITL 应处在工具调用末端，以看到最终工具集。
- SubAgent 分同步本地子 Agent 与异步远程子 Agent；异步子 Agent 必须有 `start/check/update/cancel/list` 生命周期工具。
- Backend 抽象应覆盖状态后端、文件系统后端、沙箱命令后端，并通过同一权限系统裁剪。
- MemoryMiddleware 应支持从本地 `AGENTS.md`/项目规则注入，并将“如何更新记忆”作为系统策略。
- 文件/工具结果过大时要自动写入 artifact 后只保留引用，避免上下文爆炸。

AgentForge 不应直接复制：

- 绑定 LangGraph 的状态图实现。
- 只支持 Python 的 Agent Protocol SDK 形态；可以抽象为可替换 RemoteAgentClient。

## 4. 端侧 Agent 开发框架需求长清单

### 4.1 Runtime 与 Agent Core

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| R-001 | Agent run 必须有稳定 `runId`、`threadId`、`resourceId` | P0 | Mastra/DeepAgents |
| R-002 | 支持 `run`、`stream`、`observe`、`cancel`、`pause`、`resume` | P0 | AgentScope/AgentForge |
| R-003 | Agent loop 支持最大步数、工具调用、多轮 ReAct、退出条件 | P0 | 三者共同 |
| R-004 | 支持流式 text、tool_call、tool_result、state、error、done 事件 | P0 | AgentForge/Mastra |
| R-005 | 支持 durable checkpoint，可从 tool approval、错误、进程重启后恢复 | P0 | Mastra/DeepAgents |
| R-006 | 支持 pending tool call 人审，同步流与非流模式都能恢复 | P0 | Mastra/DeepAgents |
| R-007 | 支持中断后补写 tool_result 或 interruption event，避免上下文断裂 | P1 | AgentScope |
| R-008 | 支持 tool calls 顺序执行、并行执行、并发度限制 | P1 | AgentScope |
| R-009 | 支持 structured output schema 与强制 finish tool | P1 | Mastra/AgentScope |
| R-010 | 支持 prompt processors、input/output processors、error processors | P1 | Mastra |
| R-011 | 支持 model fallback、重试、router、超时、首 token 超时、chunk 超时 | P1 | Mastra/AgentForge |
| R-012 | 支持多模态 message block 基础类型预留 | P2 | AgentScope |

### 4.2 Tool、Skill、MCP

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| T-001 | Tool 定义包含 `name/description/inputSchema/outputSchema/execute` | P0 | Mastra |
| T-002 | Tool execute context 包含 run、thread、agent、workflow、memory、sandbox、tracer、abortSignal | P0 | Mastra |
| T-003 | Tool input/output 都要校验，错误以结构化 tool result 回写 | P0 | Mastra |
| T-004 | 工具结果支持 string、JSON、artifact reference、stream chunk | P0 | Mastra/DeepAgents |
| T-005 | 支持工具级 approval、权限、超时、重试、background 配置 | P0 | Mastra/DeepAgents |
| T-006 | 支持工具结果过大自动 offload 到本地 artifact store | P1 | DeepAgents |
| T-007 | 支持 Skill 作为可发现、可加载、可注入 prompt/tool 的能力单元 | P1 | DeepAgents |
| T-008 | 支持 MCP stdio、SSE、streamable-http，工具元数据可追踪 | P1 | 三者共同 |
| T-009 | 支持 MCP server 在线添加/删除/热加载 | P2 | 端侧运维需求 |
| T-010 | 支持 provider-defined tools 与 AI SDK tool 兼容层 | P2 | Mastra |

### 4.3 Workflow 与调度

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| W-001 | Workflow step 支持 input/output schema、retries、metadata | P0 | Mastra |
| W-002 | 支持顺序、并行、分支、循环、foreach、条件跳转 | P1 | Mastra/AgentForge |
| W-003 | Workflow run 支持 runId、state、stepResults、activePaths | P1 | Mastra |
| W-004 | 支持 suspend/resume、human input、approval resume | P1 | Mastra |
| W-005 | 支持 workflow stream/watch 事件 | P1 | Mastra |
| W-006 | 支持 restart/time travel 基础模型，至少可从 checkpoint 重跑某步 | P2 | Mastra |
| W-007 | 支持 Cron/Heartbeat/延迟任务/周期任务 | P1 | 端侧业务/OpenClaw |
| W-008 | 支持任务锁、幂等、重复触发去重、失败重试策略 | P1 | 端侧长期运行 |

### 4.4 Memory、Session、RAG

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| M-001 | Session/thread 持久化，支持多用户/多项目隔离 | P0 | AgentForge/AgentScope |
| M-002 | Message history 支持窗口裁剪、tool pair 保序、系统消息隔离 | P0 | AgentScope |
| M-003 | Working memory 支持模板与可编辑状态 | P1 | AgentForge/AgentScope |
| M-004 | Long-term memory 支持 retrieve/record 两种模式 | P1 | AgentScope |
| M-005 | AGENTS.md / project memory 自动加载并注入系统提示 | P1 | DeepAgents |
| M-006 | 超阈值自动压缩 summary，保留最近 tool use/result pair | P1 | AgentScope |
| M-007 | RAG 支持文档 reader、embedding、vector store、rerank | P2 | AgentScope/Mastra |
| M-008 | 记忆更新有安全策略，不保存 secrets/token/password | P0 | DeepAgents |

### 4.5 SubAgent 与多 Agent 协作

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| A-001 | 本地 SubAgent 支持注册、描述、隔离上下文、父子消息过滤 | P0 | DeepAgents/AgentForge |
| A-002 | SubAgent delegation 有 start/complete hooks 与审计事件 | P1 | Mastra/AgentForge |
| A-003 | 异步远程 SubAgent 支持 start/check/update/cancel/list | P1 | DeepAgents |
| A-004 | MsgHub/Channel 支持多 Agent 广播、订阅、自动/手动广播 | P1 | AgentScope |
| A-005 | SubAgent 可继承或覆盖父 Agent 的模型、工具、权限、HITL | P1 | DeepAgents |
| A-006 | SubAgent 运行状态进入 task store，支持上下文压缩后找回 task_id | P1 | DeepAgents |
| A-007 | 支持 A2A/Agent Protocol 适配层 | P2 | AgentScope/DeepAgents |

### 4.6 Security、Sandbox、权限

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| S-001 | 文件读写权限使用 allow/deny 规则，默认保护敏感路径 | P0 | DeepAgents/AgentForge |
| S-002 | 命令执行必须进入 sandbox backend，支持超时、输出限制、工作目录限制 | P0 | DeepAgents |
| S-003 | 文件权限与命令权限分开建模，禁止路径规则误覆盖 shell 权限 | P0 | DeepAgents |
| S-004 | 所有 tool call 有审计日志：调用者、参数摘要、结果摘要、耗时、状态 | P0 | Mastra |
| S-005 | HITL 支持按工具、路径、命令、风险级别触发 | P0 | DeepAgents/Mastra |
| S-006 | Secret scanner 拦截 prompt、memory、tool result、artifact 写入 | P1 | 端侧安全 |
| S-007 | Server API 支持 auth、rate limit、CORS、tenant/project boundary | P1 | AgentForge/Mastra |

### 4.7 Observability、Evals、质量

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| O-001 | Agent/tool/workflow/model/memory/server 全链路 span | P1 | Mastra/AgentScope |
| O-002 | 支持 OTEL exporter、console exporter、本地 trace store | P1 | AgentScope/Mastra |
| O-003 | 记录 token、latency、tool error、retry、approval、resume 指标 | P1 | Mastra |
| O-004 | 支持 run replay/debug，以 runId 查看事件时间线 | P2 | Mastra |
| O-005 | 支持 scorer/evaluator，对 agent 输出与 trace 打分 | P2 | Mastra/AgentScope |
| O-006 | E2E 测试提供 mock model、mock tool、deterministic replay | P0 | 三者共同 |

### 4.8 CLI、SDK、Server、Studio

| 编号 | 需求 | 优先级 | 来源启发 |
| --- | --- | --- | --- |
| D-001 | CLI 支持 create/init/dev/build/start/run/lint，且命令与文档一致 | P0 | Mastra/AgentForge |
| D-002 | SDK 支持 run、stream、sessions、status、tasks、approvals | P1 | AgentForge |
| D-003 | Server API 支持 OpenAPI 动态生成，不使用静态半成品 spec | P1 | Mastra |
| D-004 | Studio 最小版支持 sessions、runs、tools、memory、MCP、tasks 可视化 | P2 | AgentScope/Mastra |
| D-005 | 支持配置热加载：skills/subagents/mcp/policies | P2 | 端侧业务需求 |
| D-006 | 支持本地 daemon/desktop app 长驻运行与 heartbeat | P2 | 端侧业务/OpenClaw |

## 5. AgentForge 目标设计文档

### 5.1 定位

AgentForge 应定位为“TypeScript 端侧 Agent Runtime Kit”，不是一开始就做 Mastra 式全栈平台。核心目标：

- 端侧长期运行稳定：可恢复、可审计、可取消、可重试。
- 本地能力安全可控：文件、命令、网络、MCP、Skill、SubAgent 都经过同一策略系统。
- 开发者集成简单：CLI/SDK/Server 直接可用，配置驱动但允许代码优先。
- 强类型 API：TypeScript 公共 API 不使用 `any`，内部也应逐步消除 `any`。

### 5.2 分层架构

```text
App / CLI / SDK / Server / Studio
Runtime Orchestrator: AgentRun / WorkflowRun / TaskRun / Scheduler
Agent Core: model loop / tool loop / stream / HITL / processors
Capabilities: Tools / MCP / Skills / SubAgents / Workflows / Middleware
State Layer: Session / Memory / Checkpoint / Artifact / Task Store
Safety Layer: Sandbox / Permission / Secret Guard / Approval Policy
Observability: Trace / Metrics / Logs / Replay / Eval
Storage Backends: InMemory / FileSystem / SQLite / Remote-adapter
```

### 5.3 核心抽象

公共类型建议围绕以下抽象收敛：

```typescript
export interface RunIdentity {
  runId: string;
  threadId: string;
  resourceId?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  approval?: ApprovalPolicy;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput | ToolArtifact | ToolStream>;
}

export interface ToolExecutionContext extends RunIdentity {
  agentId: string;
  abortSignal: AbortSignal;
  memory: MemoryRuntime;
  sandbox: SandboxRuntime;
  tracer: TraceRuntime;
  artifacts: ArtifactStore;
}

export interface AgentRuntime {
  run(input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
  stream(input: string, options?: AgentRunOptions): AsyncIterable<AgentEvent>;
  observe(message: AgentMessage): Promise<void>;
  resume(runId: string, resumeData: unknown): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
}
```

### 5.4 执行流

1. CLI/SDK/Server 创建 `AgentRun`，分配 `runId/threadId`。
2. Runtime 加载配置、项目 memory、session history、policy、tools、MCP、skills、subagents。
3. Agent Core 构造 model request，执行 input processors。
4. 模型流式返回 text/tool_call。
5. Tool call 进入 Permission、SecretGuard、HITL、Sandbox、Timeout、Trace middleware。
6. Tool result 写入 history；超大结果写入 artifact，只把引用回填上下文。
7. 如需要继续 ReAct loop，回到模型；否则写 checkpoint、run result、metrics。
8. 如果 suspended，保存 snapshot 与 pending approval；通过 `resume(runId, data)` 恢复。

### 5.5 存储设计

| Store | 内容 | 最小实现 |
| --- | --- | --- |
| `SessionStore` | session、messages、thread metadata | SQLite + InMemory |
| `RunStore` | run status、events、usage、error | SQLite |
| `CheckpointStore` | snapshots、pending tool calls、workflow state | SQLite |
| `MemoryStore` | working memory、long-term memory、observations | SQLite + file |
| `ArtifactStore` | tool 大结果、文件引用、下载内容 | filesystem |
| `TaskStore` | async subagent/scheduler task 状态 | SQLite |
| `TraceStore` | spans、metrics、event timeline | SQLite/OTEL exporter |

### 5.6 中间件顺序

推荐固定顺序：

```text
InputProcessors
MemoryInjection
SkillInjection
ToolNormalization
SubAgentToolInjection
UserMiddleware
ModelFallbackAndRetry
ToolCallPatch
HumanInTheLoop
Permission
SecretGuard
SandboxExecution
ResultOffload
OutputProcessors
TracingAndMetrics
```

其中 Permission、SecretGuard、SandboxExecution 应靠后，因为它们必须看到最终工具集合和最终工具参数。

### 5.7 Roadmap

| 阶段 | 目标 | 主要交付 |
| --- | --- | --- |
| P0：现实对齐 | 让现有框架可稳定使用 | 修复测试、CLI、文档、`any`、package 元数据、OpenAPI 与 README 不一致 |
| P1：可靠运行时 | 端侧长任务可恢复、安全可审计 | RunStore、Checkpoint、HITL resume、Permission+Sandbox、TaskStore、artifact offload |
| P2：多 Agent 与工作流 | 复杂任务编排 | Durable Workflow、async subagent、MsgHub/Channel、scheduler/heartbeat |
| P3：生产体验 | 可观测与管理 | OTEL、Replay、Eval scorer、Studio、热加载管理 |

## 6. 当前 AgentForge 差距

### 6.1 已具备能力

| 能力 | 当前状态 | 代码位置 |
| --- | --- | --- |
| 基础 Agent loop | 已有 RxJS stream、tool call、state machine | `src/agent/agent.ts` |
| AgentFactory | 已有配置到 Agent 的装配 | `src/agent/factory.ts` |
| OpenAI-compatible Adapter | 已有 AI SDK `streamText` 适配、timeout/interceptor | `src/adapters/ai.ts` |
| ToolRegistry 与内置工具 | 已有 read/write/ls/bash/search 等 | `src/registry.ts`, `src/tools/` |
| Config loader/schema | 已有 Zod schema 与 markdown/json 配置 | `src/config/` |
| Plugin hooks | 已有 typed HookMap 与 provider hook | `src/plugin/` |
| MemoryManager | 已有 message history、working memory、observational memory、storage interface | `src/memory/` |
| Session/Checkpoint | 已有 session API 与 checkpoint manager | `src/session/` |
| Workflow builder | 已有 step/then/parallel/branch/loop/suspend 基础 | `src/workflow/` |
| MCP | 已有 client/config/toolkit/transport | `src/mcp/` |
| SubAgent | 已有 registry、delegate tool、isolated filter | `src/subagent/` |
| Sandbox policy | 已有 allowed/denied path 与敏感路径 deny | `src/sandbox/` |
| Server/SDK | 已有 Hono server、SSE、sessions、client | `src/server/`, `src/sdk/` |

### 6.2 主要差距

| 领域 | 差距 | 影响 | 建议优先级 |
| --- | --- | --- | --- |
| 质量基线 | 源码中仍存在 `any`，CLI dev/start 有类型绕过；文档有乱码；README 与实际实现不完全一致 | 影响可维护性与信任 | P0 |
| 测试基线 | 最近本地全量测试存在 CLI/sandbox/session/e2e 等失败项 | 影响发布质量 | P0 |
| Agent run | `runStream` 是内存执行，缺少 durable run snapshot 与 resume | 长任务断点恢复不足 | P1 |
| HITL | README 宣称 HITL middleware，但当前实际中间件列表未形成完整 approval/resume 闭环 | 高风险工具不能可靠人审 | P1 |
| Tool 系统 | Tool 只有简单 parameters 与 string result，缺少 output schema、artifact、approval、stream writer、context | 工具生态扩展受限 | P1 |
| Sandbox | 有 path policy，但 sandbox 与工具执行/命令执行的统一后端能力不足 | 文件/命令边界不完整 | P1 |
| Workflow | 当前 builder 类型很轻，缺少 schema、runId、snapshot、watch、resume、time travel | 无法承接复杂业务流 | P1 |
| Memory | 有基础 memory，但缺少 long-term retrieval、RAG、压缩策略与 AGENTS.md memory 注入 | 长上下文任务能力弱 | P1 |
| SubAgent | 有本地 delegate，但缺少 async remote task 生命周期、任务状态持久化、并发管理 | 多 Agent 长任务能力不足 | P2 |
| Observability | span/tracer 基础存在，但不是 OTEL 级全链路，也缺 trace store/replay/scorer | 生产排障不足 | P2 |
| Server/OpenAPI | OpenAPI 是静态简化 spec，未覆盖 sessions/tasks/approvals | SDK/集成体验不完整 | P1 |
| CLI | 曾缺 build command，dev/start 与文档/测试存在偏差 | 本地开发体验不稳 | P0 |
| Package metadata | `package.json` repository/homepage 仍是 `your-org` | 发布与用户信任问题 | P0 |
| Docs | `docs/architecture/overview.md` 提到 `src/cache`，当前源码无对应目录；README 中权限示例引用未导出的 permissions | 文档误导 | P0 |

### 6.3 与三方框架能力对照

| 能力 | AgentForge | Mastra | AgentScope | DeepAgents |
| --- | --- | --- | --- | --- |
| TypeScript 强类型 API | 中 | 强 | 不适用 | 不适用 |
| Durable workflow | 弱 | 强 | 中 | 依赖 LangGraph |
| Tool schema/input/output | 弱-中 | 强 | 中 | 中 |
| HITL approval/resume | 弱 | 强 | 中断支持 | 强 |
| Async subagent task | 弱 | 中 | 中 | 强 |
| MsgHub/Channel | 中 | 中 | 强 | 弱 |
| Memory compression | 弱 | 中 | 强 | 中 |
| RAG/vector | 弱 | 强 | 强 | 弱 |
| Sandbox/permission | 中 | 中 | 弱 | 强 |
| Observability/eval | 弱-中 | 强 | 强 | 中 |
| Studio/playground | 弱 | 强 | 强 | 弱 |
| 端侧轻量 | 强 | 中 | 中 | 中 |

## 7. 优先行动清单

### P0：先把当前框架打牢

1. 修复 `src/cli/commands/dev/start` 中的 `any`，消除公共与核心源码中的 `any`。
2. 让 `npm run typecheck`、`npm run build`、核心单测稳定通过；隔离需要真实模型的 e2e。
3. 修正 README/docs 中与现实不一致的权限、cache、CLI、repository 信息。
4. 将 OpenAPI spec 从静态对象迁移到路由/Schema 派生，至少补齐 session routes。
5. 定义 `RunIdentity`、`RunStore`、`AgentEvent` 标准事件协议，为 P1 铺底。

### P1：补齐端侧可靠运行时

1. 实现 durable `AgentRun`：run events、checkpoint、pending tool calls、resume/cancel。
2. 实现 approval middleware：按工具/路径/命令触发，支持 stream/generate 两种 resume。
3. 重构 ToolDefinition：增加 output schema、ToolExecutionContext、artifact result、stream writer。
4. 将 sandbox 从 path helper 提升为 backend，统一文件与命令执行入口。
5. Memory 增加 AGENTS.md injection、压缩、long-term retrieve/record 接口。
6. Workflow run 增加 runId、snapshot、watch、resume，先不做 time travel。

### P2：形成框架差异化

1. 实现 AsyncSubAgent：`start/check/update/cancel/list` 工具与 TaskStore。
2. 实现 MsgHub/Channel，让多 Agent 可广播协作。
3. 接入本地 scheduler/heartbeat，与端侧长期任务结合。
4. 实现 OTEL exporter、trace store、run replay。
5. 提供 Studio 最小版：sessions、runs、tools、MCP、memory、tasks。

## 8. 结论

AgentForge 当前已经具备“轻量 TypeScript Agent runtime”的雏形，但距离“生产级端侧 Agent 开发框架”仍差一个可靠运行时层。三方框架给出的共同信号是：下一阶段不要优先堆 UI 或生态，而要先把 runId、checkpoint、resume、approval、permission、artifact、task store、trace 这些底层协议补齐。只要这一层打牢，现有的 Agent、Plugin、MCP、Skill、SubAgent、Workflow 都能被统一起来，AgentForge 才能从 demo framework 进入可长期运行的端侧业务框架。

## 9. 参考源码与文档

- Mastra repository: <https://github.com/mastra-ai/mastra>
- Mastra Agent source: <https://github.com/mastra-ai/mastra/blob/main/packages/core/src/agent/agent.ts>
- Mastra Workflow source: <https://github.com/mastra-ai/mastra/blob/main/packages/core/src/workflows/workflow.ts>
- Mastra Tool Builder source: <https://github.com/mastra-ai/mastra/blob/main/packages/core/src/tools/tool-builder/builder.ts>
- AgentScope repository: <https://github.com/agentscope-ai/agentscope>
- AgentScope ReActAgent source: <https://github.com/agentscope-ai/agentscope/blob/main/src/agentscope/agent/_react_agent.py>
- AgentScope AgentBase source: <https://github.com/agentscope-ai/agentscope/blob/main/src/agentscope/agent/_agent_base.py>
- AgentScope Pipeline source: <https://github.com/agentscope-ai/agentscope/tree/main/src/agentscope/pipeline>
- DeepAgents repository: <https://github.com/langchain-ai/deepagents>
- DeepAgents graph source: <https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/graph.py>
- DeepAgents async subagents middleware: <https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/async_subagents.py>
- DeepAgents permissions middleware: <https://github.com/langchain-ai/deepagents/blob/main/libs/deepagents/deepagents/middleware/permissions.py>
- AgentForge repository: <https://github.com/Yamdy/agentforge>
