# AgentForge 差距分析：通用 Agent Server SDK

> 分析日期：2026-05-20
> 目标：评估 AgentForge 作为通用 Agent Server SDK 与业界最佳实践的差距

---

## 1. AgentForge 已具备的能力

| 模块 | 实现位置 | 成熟度 |
|------|----------|--------|
| **核心引擎** | `Agent` + `LoopOrchestrator` + `Pipeline` | 完整 |
| **Tool Registry** | `ToolRegistry` + Hook 集成 | 完整 |
| **Sub-agent** | `createSubAgentTool` + contextPolicy | 完整 |
| **Session 管理** | `SessionManager` + JSONL 持久化 + suspend/resume | 完整 |
| **Memory** | 多后端 (InMemory/SQLite) + 自动注入 + 修正检测 | 完整 |
| **MCP 集成** | `mcpPlugin` (stdio/sse/http) + 工具发现 | 完整 |
| **Skills** | `skillPlugin` + 发现 + 渐进式加载 | 完整 |
| **Permission** | `permissionPlugin` (allow/deny/ask) + 模式 + 规则 | 完整 |
| **HTTP Server** | `AgentForgeServer` (Hono) + REST + WebSocket | 完整 |
| **A2A 协议** | Agent-to-Agent 互通 | 完整 |
| **Studio UI** | Vue 3 前端 | 完整 |

---

## 2. 关键差距分析

### 2.1 默认 Agent 角色

**业界实践对比：**

| 项目 | 默认角色 | 设计理念 |
|------|----------|----------|
| OpenCode | 2 Primary + 3 Subagent | `build` + `plan` + `general`/`explore`/`scout` |
| Mastra | 无内置角色 | 纯 SDK，用户自行配置 |
| CrewAI | 无内置角色 | 框架层，用户定义 Agent + Crew |
| AgentScope | 无内置角色 | 底层框架，提供 Agent 基类 |

**建议：3 个默认角色**

```
┌─────────────────────────────────────────────────────┐
│  Primary: Executor (默认)                           │
│  - 全权限执行                                        │
│  - 用于一般任务                                      │
├─────────────────────────────────────────────────────┤
│  Primary: Planner                                   │
│  - 只读权限                                          │
│  - 用于规划、分析、review                            │
├─────────────────────────────────────────────────────┤
│  Subagent: Researcher                               │
│  - 只读 + web_search/web_fetch                      │
│  - 用于信息收集、外部研究                            │
└─────────────────────────────────────────────────────┘
```

**设计原则：**
- 通用框架底座应提供「最小可用」角色集
- 用户可扩展/覆盖，但开箱即用
- 参考 OpenCode 的 `mode: primary | subagent | all` 分类

**实现位置：** `packages/core/src/agent-roles/`

---

### 2.2 编排抽象

**业界实践对比：**

| 项目 | 编排抽象 | 核心概念 |
|------|----------|----------|
| OpenCode | Task Tool | `@mention` 调用 subagent，无显式编排层 |
| Mastra | Workflow | Step-based DAG，`.then()/.branch()/.parallel()` |
| CrewAI | Crew + Process | `Process.sequential` / `Process.hierarchical` |
| AgentScope | 无 | 纯 Agent 基类，无编排层 |

**第一性原理分析：**

```
编排 = 任务分解 + 分配 + 协调 + 结果聚合

三种基本模式：
1. Sequential (串行):     A → B → C
2. Parallel (并行):       A ┬→ B → D
                           └→ C ┘
3. Hierarchical (层级):   Orchestrator → [Worker1, Worker2]
```

**推荐方案：**

```typescript
// 基于 Pipeline 的编排器
interface OrchestratorConfig {
  mode: 'sequential' | 'parallel' | 'conditional';
  agents: AgentConfig[];
  router?: (context: PipelineContext) => string; // Agent 选择器
  aggregator?: (results: AgentRunResult[]) => string; // 结果聚合
}

// 示例：顺序执行
const pipeline = new OrchestrationPipeline()
  .step(plannerAgent)      // 规划
  .step(executorAgent)     // 执行
  .step(reviewerAgent);    // 审查

// 示例：条件路由
const router = new AgentRouter({
  routes: {
    'code': codeAgent,
    'research': researchAgent,
  },
  default: generalAgent,
});
```

**实现优先级：** 先实现 `sequential` 模式（最常用），再扩展 `parallel` 和 `conditional`

**实现位置：** `packages/core/src/orchestration/`

---

### 2.3 模型发现机制（不适用）

> **结论：此功能不适用于 AgentForge Server SDK。**

**分析：**

OpenCode 是 CLI/TUI 工具，用户需要在界面中**交互式选择**模型，因此需要 Models.dev 提供模型列表。

AgentForge 是 Server SDK，用户在代码中**硬编码**模型字符串：
```typescript
const agent = new Agent({ model: 'anthropic/claude-sonnet-4' })
```

**模型切换场景（如 Studio UI）应从用户配置读取，而非远程 API：**
- 用户只看到自己已配置 API Key 的模型
- 展示 Models.dev 全量模型无意义（大部分用户没 Key）
- 模型能力信息用户可查文档，API 错误会给出反馈

**不需要额外实现。**

---

### 2.4 预构建工具库

**业界实践对比：**

| 项目 | 预构建工具 | 非编码相关 |
|------|------------|------------|
| OpenCode | 12+ 内置 | `websearch`, `webfetch`, `read`, `grep`, `glob` |
| Mastra | 无内置 | 用户自定义 Tool |
| CrewAI | 工具包市场 | `FileReadTool`, `CSVSearchTool` 等 |

**推荐内置工具（非编码）：**

```typescript
const builtinTools = {
  // 信息获取
  web_search: { description: '搜索网页信息' },
  web_fetch: { description: '获取网页内容' },

  // 数据处理
  http_request: { description: 'HTTP 请求' },
  json_parse: { description: 'JSON 解析' },

  // 文件操作（通用）
  file_read: { description: '读取文件' },
  file_write: { description: '写入文件' },
  file_list: { description: '列出目录' },

  // 系统
  shell_exec: { description: '执行命令' },

  // 记忆
  memory_store: { description: '存储记忆' },
  memory_retrieve: { description: '检索记忆' },
};
```

**实现位置：** `packages/tools/src/builtin/`

---

### 2.5 长时间任务支持

**业界实践对比：**

| 项目 | 长任务支持 | 机制 |
|------|------------|------|
| Mastra | Workflow suspend/resume | `workflow.suspend()` + `workflow.resume()` |
| OpenCode | Session persistence | `--continue` + `--session` |
| CrewAI | Checkpoint | `CheckpointConfig` |

**推荐方案：三层架构**

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Task Queue (任务队列)                         │
│  - 入队：返回 taskId                                    │
│  - 异步执行：后台 Worker                                │
│  - 状态查询：progress / result                          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Checkpoint (断点)                             │
│  - AgentForge 已有 serialize/deserialize               │
│  - 每 iteration 自动 checkpoint                         │
│  - 支持 resume from checkpoint                          │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Notification (通知)                           │
│  - WebSocket 实时推送                                   │
│  - Webhook 回调                                         │
│  - EventBus 事件订阅                                    │
└─────────────────────────────────────────────────────────┘
```

**接口设计：**

```typescript
interface TaskQueue {
  enqueue(input: string, options?: TaskOptions): Promise<TaskHandle>;
  getStatus(taskId: string): Promise<TaskStatus>;
  cancel(taskId: string): Promise<void>;
}

interface TaskHandle {
  taskId: string;
  status: 'pending' | 'running' | 'suspended' | 'completed' | 'failed';
  on(event: 'progress' | 'complete' | 'error', handler: Function): void;
}
```

**实现位置：** `packages/core/src/task-queue/`

---

### 2.6 OTel 集成（暂缓）

**优先级：** P2

**已有基础：** `EventSystem` + `EventBus` + Trace/Span 抽象 ✅

**待实现：** OpenTelemetry 导出器、指标聚合、日志集成

---

## 3. 优先级路线图

| 优先级 | 差距项 | 工作量 | 业务价值 | 状态 |
|--------|--------|--------|----------|------|
| **P0** | 默认 Agent 角色 (3个) | 低 | 开箱即用 | ✅ 已完成 |
| **P0** | 预构建工具库 | 中 | 快速开发 | ✅ 已完成 |
| **P1** | 编排抽象层 | 高 | 多 Agent 系统 | ✅ 已完成 |
| **P1** | 任务队列 | 高 | 长时间任务 | ✅ 已完成 |
| **P2** | ~~模型发现~~ | - | - | ❌ 不适用 (CLI 功能，SDK 不需要) |
| **P2** | OTel 集成 | 中 | 生产运维 | 部分完成 |

---

## 4. 参考项目

| 项目 | 路径 | 参考价值 |
|------|------|----------|
| OpenCode | `.tmp/opencode` | Agent 角色、权限系统、模型发现 |
| Mastra | `.tmp/mastra` | Workflow 编排、suspend/resume |
| CrewAI | `.tmp/crewAI` | Crew 编排、Process 模式 |
| AgentScope | `.tmp/agentscope` | Agent 基类设计 |

---

## 5. 已完成实现

### P0-1: 默认 Agent 角色模板 ✅
- 实现位置: `packages/core/src/presets/`
- 包含: `executor`, `planner`, `researcher` 三个预设角色
- 测试: `__tests__/presets.test.ts` (15 tests)

### P0-2: 预构建工具库 ✅
- 实现位置: `packages/tools/src/`
- 包含: 16 个内置工具 (web_search, web_fetch, memory, http, file, shell 等)
- 分类: file, web, system, utility, memory

### P1-1: 编排抽象层 ✅
- 实现位置: `packages/core/src/orchestration/`
- 包含: `SequentialExecutor`, `ParallelExecutor`, `AgentRouter`, `OrchestrationPipeline`
- 测试: `__tests__/orchestration/` (15 tests)

### P1-2: 任务队列 ✅
- 实现位置: `packages/core/src/task-queue/`
- 包含: `TaskQueueImpl`, `autoCheckpointPlugin`, `TaskNotificationManager`
- 测试: `__tests__/task-queue/` (7 tests)

---

## 6. 待处理事项

### ~~P2-1: 模型发现机制~~ ❌ 已取消

**取消原因：**
- OpenCode 是 CLI 工具，需要交互式模型选择
- AgentForge 是 Server SDK，用户在代码中硬编码模型字符串
- Studio UI 模型切换应从用户配置读取，而非远程 API
- 模型能力信息用户可查文档，API 错误会给出反馈

### P2-2: OTel 集成完善
- **目标**: 完整 OpenTelemetry 导出器
- **已有基础**: `EventSystem` + `EventBus` + Trace/Span 抽象 ✅
- **待实现**:
  - OTLP 导出器配置
  - 指标聚合 (Metrics)
  - 日志集成 (Logs)
- **工作量**: 中 (~6h)


---

## 2026-05-22 状态更新

P0（3/3已完成）、P1（5/8已完成）、P2（12/12已完成）。总完成度 20/23（87%）。

### 非 Gap 说明（详见 design/adr/）

- **Dead Letter Queue**: 非 gap。Server/SDK 离散执行，调用方即 DLQ。详见 [ADR-0001](../design/adr/0001-dlq-unnecessary-for-server-sdk.md)
- **Suspend 超时**: 非 gap。由 Session TTL 覆盖。详见 [ADR-0002](../design/adr/0002-suspend-timeout-covered-by-session-ttl.md)

### 唯一剩余 Gap

- **PermissionManager 持久化**: 当前纯内存 Promise，进程重启后 HITL 决策链断裂。修复方向是将决策事件标准化写入 session event log。
