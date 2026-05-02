---
## Goal

AgentForge — Agent Harness 框架。核心理念：**Agent = LLM（认知决策核心）+ Harness（工程管控基座）**。基于命令式 `while(true)` 事件循环 + Zod 类型安全，提供执行管控、资源约束、状态持久、安全隔离、行为可观测。

## Architecture Philosophy

### Harness 定位

```
Agent = LLM（认知决策核心）+ Harness（工程管控基座）
```

- **LLM 负责**：推理、决策、语义理解
- **Harness 负责**：执行管控、资源约束、状态持久、安全隔离、行为可观测
- **所有 Agent 行为必须经过 Harness 管控，不可绕过**

### 核心范式：命令式循环 + 事件发射器

```
run() → Promise<string>
   └── while(true) 循环（命令式，非流驱动，非 expand 递归）
       └── Hook 切面（RequestHook/ToolHook/LifecycleHook）
           └── MPU 跨切面检查点（安全/配额/熔断/限流/压缩）
               └── await llm.chat() → await tools.execute() → checkpoint
                   └── AgentEventEmitter.emit() 可观测
```

**设计起源**：2026-04-30 从 RxJS Observable + expand 递归全面重构为命令式循环。原因：RxJS 的 `expand` 异步陷阱导致事件重复/丢失，流驱动模型与"Harness 硬管控"的设计意图存在结构性冲突。参考 ClaudeCode + OpenCode 的 Hook 切面模式，形成了 "`while(true)` + HookRegistry + AgentEventEmitter" 的现代架构。

### 三层 API（渐进式复杂度）

| 层次 | 用户 | 核心入口 | 能力 |
|------|------|---------|------|
| **L1: 零代码** | 非程序员 | JSON/JSONC 配置 → `createAgentFromConfig()` | 声明式，预设驱动 |
| **L2: 配置式** | 应用开发者 | `createAgent(config)` | 配置驱动，快速集成 |
| **L3: 编程式** | 框架开发者 | `ContextBuilder` + `createAgentLoop()` | 完全控制，DI 注入 |

每层可用能力是上层的超集，不可出现能力断层（A5 铁律）。

## Constraints & Preferences

### TypeScript 严格模式（禁止违反）
```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noUncheckedIndexedAccess": true,    // arr[0] 是 T | undefined
  "exactOptionalPropertyTypes": true,  // foo?: string 意味着 omit only
  "verbatimModuleSyntax": true         // 本地 import 必须带 .js 扩展名
}
```

### 关键约束
- **ESM only**：`"type": "module"`，禁止 `require()`，懒加载用 `await import()`
- **import 约定**：本地导入带 `.js` 扩展名，类型导入用 `import type` 关键字
- **exactOptionalPropertyTypes 陷阱**：`string | undefined` 无法赋值给 `string?`，必须条件展开 `...(val !== undefined ? { key: val } : {})`
- **Vitest globals 模式**：`describe`/`it`/`expect` 无需 import
- **Pre-commit hooks**：eslint --fix + prettier --write（Husky + lint-staged）
- **不含 RxJS**：项目不含任何 RxJS 依赖或术语（`docs/archive/rxjs/` 作为历史参考可保留）

## Iron Laws（15 条：5A + 6R + 4I）

> 完整体系见 [docs/design/00-OVERVIEW.md](./docs/design/00-OVERVIEW.md)

### 架构层（5 条）

| # | 铁律 | 执行状态 |
|---|------|---------|
| A1 | 命令式循环 while(true) + await + AgentEventEmitter | ✅ 已执行 |
| A2 | Harness 硬管控，安全校验不可绕过 | ⚠️ 部分接线 — `checkCommand` 已接入，`rateLimiter`/`inputSanitizer`/`permissionController` 未接线 |
| A3 | Zod 分层数据契约，as any 零容忍 | ⚠️ 38 处 `as any` 待清理（create-agent.ts: 19, agent-loop.ts: 7, 其他: 12） |
| A4 | DI 解耦 + 上下文闭包 | ✅ 基本执行 |
| A5 | 三层 API（L1/L2/L3）渐进式复杂度 | ⚠️ L3 缺部分 builder 方法，L1 缺 `history` 等字段 |

### 运行时（6 条）

| # | 铁律 | 执行状态 |
|---|------|---------|
| R1 | 错误即事件，不 throw | 🔴 P0 — `agent-loop.ts:839` 仍在 emit error 后 throw |
| R2 | Hook 异常隔离，不击穿 | ✅ 已执行 |
| R3 | 工具调用必经注册表 | ✅ 已执行 |
| R4 | 主流程串行，副作用并行 | ✅ 已执行 |
| R5 | 状态外部化，可中断恢复 | ✅ 基本执行 |
| **R6** | **检查点声明式接线** — 所有跨切面关注点通过 CheckpointRegistry 注册，禁止 `if (ctx.X)` 硬编码门控 | 🔮 提案中 — 2026-05-02 新增 |

### 实现（4 条）

| # | 铁律 | 执行状态 |
|---|------|---------|
| I1 | 类型安全零容忍（as any / @ts-ignore 视为债务） | ⚠️ 38 处待清理 |
| I2 | ESM + verbatimModuleSyntax，不含 RxJS | ✅ 已执行 |
| I3 | 外部输入永远不信任（Zod safeParse 兜底） | ✅ 基本执行 |
| I4 | 测试即文档 | ⚠️ 部分模块零测试 |

### 铁律分级

```
P0（运行时强制 — 违反则功能错误或安全漏洞）:
  A2 Harness 硬管控    R1 错误即事件      R2 Hook 异常隔离
  R3 工具注册表         R6 检查点声明式接线

P1（架构约束 — 违反则技术债务累积）:
  A3 Zod 分层契约      I1 类型安全零容忍    I3 外部输入校验

P2（设计指导 — 违反则长期维护成本增加）:
  A1 命令式循环        A4 DI 解耦          A5 三层 API
  R4 主流程串行         R5 状态外部化       I2 ESM 规范
  I4 测试文档
```

## Progress

### ✅ 已完成

#### 核心架构
- ✅ **命令式循环**：`agent-loop.ts` (1173 行)，`while(true) + await`，HookRegistry 切面
- ✅ **AgentEventEmitter**：50+ Zod 事件 Schema，`on()`/`onAny()`/`emit()`
- ✅ **Hook 系统**：RequestHook/ToolHook/LifecycleHook，异常隔离
- ✅ **6 状态机**：pending→running→paused/completed/error/cancelled
- ✅ **Checkpoint 持久化**：SQLite + 内存双后端，fire-and-forget
- ✅ **DI 解耦**：AgentContext 闭包传递，ContextBuilder 流式 API

#### MPU 模块（10 个）
- ✅ M1 SQLite 持久化存储 — Session + Checkpoint 双表
- ✅ M2 任务规划引擎 — LLMPlanner（方案 C）+ PlanExecutor 拓扑排序
- ✅ M3 Docker 沙箱隔离 — InProcessSandboxExecutor（本地），DockerSandbox（远程）
- ✅ M4 异常熔断 — CircuitBreaker 三态机 + AutoRepairer 5 策略 + ErrorClassifier
- ✅ M5 审计日志 — AuditLogger + AuditStore 哈希链
- ✅ M6 工具安全 — SecurityGuard.checkCommand（已接线），InputSanitizer（未接线）
- ✅ M7 成本管控 — QuotaController + CostTracker（已接线），RateLimiter（未接线）
- ✅ M8 可观测性 — OTelTracer + ConsoleTracer + MetricsCollector + HealthChecker
- ✅ M9 优雅关闭 — GracefulShutdown + 清理函数序列
- ✅ M10 结果校验 — QualityGate 4 规则 + ResultValidator + LLMScorer 评估管道

#### LLM 适配器
- ✅ OpenAI / Anthropic / Google / Ollama — `@ai-sdk/*` 全适配
- ✅ AdapterSystem — 错误分类/重试/Provider 注册（参考 AgentScope/Mastra）

#### Planner（方案 C：混合模式）
- ✅ LLMPlanner — Zod 结构化输出 + 回退单步计划（`src/planning/llm-planner.ts` 440 行）
- ✅ PlanExecutor.resume() — 种子恢复 + 跳过已完成 + 拓扑排序
- ✅ Agent loop 集成 — 可选 plan→execute→replan before ReAct fallback

#### 扩展能力
- ✅ A2A 协议 — Agent-to-Agent 跨进程通信，SSE 流式传输
- ✅ MCP Client — stdio/HTTP 双传输，JSON Schema → Zod 转换
- ✅ SubAgent Registry — 嵌套 Agent 注册与编排
- ✅ Workflow/Pipeline — SequentialPipeline + ParallelPipeline
- ✅ Skill 系统 — SKILL.md 热加载 + YAML 解析

#### 评估框架
- ✅ LLMScorer Builder — 3 内置 scorer + 自定义 pipeline
- ✅ QualityGate — 4 规则同步前置过滤（零 LLM 成本）
- ✅ GoalAlignmentChecker — LLM-as-Judge 目标一致性验证

#### 跨切面接线
- ✅ Auto-compaction — 前置检查点 + 错误触发 + diminishing returns
- ✅ Token Budget — 递减收益检测（0.6× delta 阈值）
- ✅ Error Recovery — 4 级错误恢复（escalate tokens → nudge → fallback model → compaction）
- ✅ Tool Concurrency — 并发安全分区（`isConcurrencySafe`）
- ✅ Cost Tracking — LLM 响应后 fire-and-forget
- ✅ Audit Trail — 全关键事件审计（llm.request/response, tool.call/result, agent.error）

#### RxJS 清零
- ✅ 移除 RxJS 依赖 — `package.json` 无 rxjs
- ✅ 文档清零 — AGENTS.md、src/注释、42 个 docs/文件、examples、benchmarks
- ✅ `docs/archive/rxjs/` — 保留 05/06/11/12/25 等历史文档

### 🔴 P0 — 当前关键问题

| 问题 | 位置 | 严重性 | 说明 |
|------|------|--------|------|
| **R1 违反** | `agent-loop.ts:839` | P0 | `throw error` — emit 后又 throw，违反"错误即事件不 throw" |
| **as any 未清零** | 9 文件 38 处 | P1→P0 | `create-agent.ts` 19 处最多，铁律要求零容忍 |
| **R6 未实施** | loop 架构 | P0 | `rateLimiter`/`inputSanitizer` 有接口无接线，接线遗漏无编译时保证 |

### 🟡 P1 — 待完善

| 问题 | 说明 |
|------|------|
| A5 L3 完善 | ContextBuilder 缺部分 MPU builder 方法 |
| A5 L1 扩展 | L1AgentConfig 缺 `history` 等字段 |
| I4 测试覆盖 | 部分模块（evaluation pipeline、OTel tracer）测试较少 |
| A2 全接线 | `rateLimiter`/`inputSanitizer`/`permissionController` 接入 loop |
| I1 as any 清偿 | 38 处 → 0，优先 `create-agent.ts` |

### 🔮 P2 — 未来工作

- Docker Sandbox 真实 Docker CLI 对接
- HITL `requiresApproval` 完整流程 + `permissionController.ask()`
- Working Memory + RAG 集成
- 外部状态机（跨 Agent 协调）
- Deployment 支持

### 测试状态
- ✅ **1731 测试通过** / 75 文件 / 33 skipped
- ✅ TypeScript 编译干净
- ✅ ESLint 0 errors
- ✅ Pre-commit hooks 正常

## Key Design Decisions

### 1. 命令式循环替代 RxJS 流驱动（2026-04-30）
**原因**：RxJS `expand` 异步陷阱导致事件重复/丢失，流驱动与 Harness 硬管控存在结构性冲突。
**方案**：`while(true) + await` 命令式循环 + HookRegistry 切面 + AgentEventEmitter 可观测。
**影响**：50+ 事件类型 → 18 核心事件，依赖消除，87 文件重构。

### 2. Hook 切面替代流拦截
**原因**：Plugin 作为事件流 Observer 无法拦截/修改流程。
**方案**：RequestHook（修改消息）、ToolHook（权限阻断）、LifecycleHook（生命周期回调）。
**设计参考**：ClaudeCode 的 Hook 系统，OpenCode 的 Plugin 架构。

### 3. 方案 C：LLMPlanner 混合模式
**原因**：纯 LLM 规划不可靠（幻觉），纯关键词启发式不智能。
**方案**：LLM 做规划决策（LLMPlanner），PlanExecutor 做执行管控（拓扑排序、并行、检查点）。LLM 决定做什么，Harness 确保做得好。
**回退**：LLM 失败时 → 单步 ReAct 模式，优雅降级。

### 4. Errors-as-Events 设计
**原则**：所有可恢复错误转化为 `agent.error` + `done` 事件。loop 内消化异常，永不 throw 到调用方。
**违规**：`agent-loop.ts:839` 仍在 emit 后 throw — 这是 R1 铁律的当前唯一违规点。

### 5. MPU 接线模式：从 ad-hoc 到声明式（R6）
**问题**：当前每新增一个 MPU 模块，开发者需在 loop 的多个位置手动插入 `if (ctx.X) { ... }` 检查。`rateLimiter`/`inputSanitizer` 定义了但从未接线。
**方案（R6）**：所有跨切面关注点通过 CheckpointRegistry 注册到生命周期阶段，loop 自动执行。未注册=未接线，注册表为可验证清单。

### 6. Zod 分层数据契约（3 Tiers）
- **Tier 1**（外部 LLM/MCP/用户输入）：`safeParse` + 降级兜底，永不崩溃
- **Tier 2**（模块边界 Checkpoint/事件总线）：编译时 Schema
- **Tier 3**（内部实现）：TypeScript 类型，无运行时开销

## MPU 接线现状

### 已完整接线
```
✅ compactionManager   → pre-LLM auto-check (739) + error-triggered (164) + post-step (1026)
✅ quota               → pre-LLM check (759) + post-LLM consume (826)
✅ qualityGate         → post-LLM validation (865)
✅ circuitBreaker      → tool error (471) + loop error (1113) + LLM success (879)
✅ autoRepairer        → catch block (1084)
✅ securityGuard       → pre-tool checkCommand (272)
✅ sandboxExecutor     → sandbox routing (306)
✅ auditLogger         → 6 事件点 (230, 292, 361, 407, 462, 790, 882, 1073)
✅ costTracker         → post-LLM (915)
✅ planner             → pre-loop (580)
✅ errorClassifier     → tool error (472) + loop error (1115)
✅ checkpoint          → post-LLM (893) + post-tool (1003)
```

### 未接线（有接口无执行）
```
⚠️ rateLimiter         → 应接入 pre-LLM (739)
⚠️ inputSanitizer      → 应接入 pre-LLM (739)
⚠️ permissionController → 应接入 pre-tool (268)
⚠️ healthChecker       → 应接入 pre-step (665) 或独立 /health
```

## Critical Context

### exactOptionalPropertyTypes 陷阱
```typescript
// ❌ 编译错误：string | undefined 不能赋给 string?
const config: AgentLoopConfig = { tokenBudget: val };  // val 可能是 undefined

// ✅ 条件展开
const config: AgentLoopConfig = {
  ...(val !== undefined ? { tokenBudget: val } : {}),
};
```

### R1 违规点（最高优先级修复）
```typescript
// agent-loop.ts:839 — 当前代码
} catch (error) {
  await runLifecycleHook('llm.error', ...);
  const recovery = await handleLLMError(error, signal);
  if (recovery === 'continue') { ... continue; }
  throw error;  // ← R1 违反：emit 后又 throw
}

// 应改为
} catch (error) {
  // ... emit agent.error + done events
  return state?.output ?? '';  // 不 throw
}
```

### 项目不含 RxJS
- `package.json` 无 rxjs 依赖
- 所有源码不含 RxJS 引用
- `docs/archive/rxjs/` 保留为历史参考（不影响主文档）

### 约束矩阵速查

| 铁律 | 检测方式 | 禁止模式 |
|------|---------|---------|
| A1 | `grep "expand\(" src/loop/` 无结果 | 禁止递归 expand、流驱动 |
| A2 | `grep "rateLimiter" src/loop/` 应有引用 | 禁止仅在 prompt 中声明安全规则 |
| R1 | `grep "throw error" src/loop/` 无结果 | 禁止 emit error 后又 throw |
| R6 | `grep "if (ctx\." src/loop/agent-loop.ts` 计数递减 | 禁止硬编码 `if (ctx.module)` 门控 |

## Relevant Files

```
src/
├── loop/
│   └── agent-loop.ts (1173 lines)      # 核心命令式循环
├── core/
│   ├── events.ts                       # AgentEventEmitter + 18 Zod Schema
│   ├── state.ts                        # AgentLoopState
│   ├── hooks.ts                        # HookRegistry
│   ├── interfaces.ts                   # 28 个 DI 接口
│   ├── context.ts (670 lines)          # AgentContext (25+ optional MPU fields)
│   ├── context-builder.ts (681 lines)  # ContextBuilder 流式 DI
│   └── state-machine.ts                # 6 状态生命周期
├── api/
│   ├── create-agent.ts                 # L2 API (含 19 处 as any)
│   ├── types.ts                        # AgentConfig + TracingConfig
│   └── run-agent.ts                    # L3 API
├── planning/
│   ├── llm-planner.ts (440 lines)      # LLMPlanner 方案 C
│   └── plan-executor.ts                # PlanExecutor.resume()
├── resilience/
│   ├── circuit-breaker.ts              # 三态机 (closed/open/half-open)
│   ├── auto-repairer.ts                # 5 内置修复策略
│   └── error-classifier.ts             # 错误严重度分类
├── evaluation/
│   ├── llm-scorer.ts                   # LLMScorer Builder 模式
│   └── pipeline.ts                     # 评估管道
├── observability/
│   └── tracers/otel-tracer.ts          # OpenTelemetry Tracer
├── security/
│   └── guard.ts                        # SecurityGuard.checkCommand
├── quota/
│   └── quota-controller.ts             # QuotaController
└── memory/
    └── compaction.ts                   # CompactionManager

docs/
└── design/
    ├── 00-OVERVIEW.md                  # 15 条铁律完整体系
    ├── README.md                       # 设计文档索引（待更新）
    └── harness.md                      # Harness 核心概念

tests/                                   # 75 文件, 1731 测试
├── loop/agent-loop.spec.ts            # 39 tests
├── planning/llm-planner.spec.ts       # 21 tests
├── evaluation/llm-scorer.spec.ts      # 6 tests
├── resilience/auto-repairer.spec.ts   # 12 tests
└── ...
```

## Version History

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | Phase 0-2c 完成 — RxJS Observable 架构 |
| v2 | 2026-04-30 | 架构重构 — 移除 RxJS，命令式循环 + Hook 切面 |
| v3 | 2026-05-02 | 铁律重写 14 条 + RxJS 清零 + LLMPlanner 方案 C + P0/P1 修复 |
| **v4** | **2026-05-02** | **文档现代化 — 回追 Harness 哲学 + R6 铁律提案 + 接线现状审计** |
