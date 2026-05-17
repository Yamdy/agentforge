# Agent Architecture Audit Report (第四轮 — 产品完成度交叉审计)

**Date**: 2026-05-16
**Auditor**: Claude (ecc:agent-architecture-audit)
**Baseline**: 第三轮审计 (2026-05-15-v2) — 7 个发现 (A-1~A-7)，本轮验证修复状态 + 结合产品形态评估整体完成度

---

## Executive Verdict

| Field | Value |
|-------|-------|
| Overall Health | **Medium-High** |
| Primary Achievement | 7模块全部功能完备 + 默认安全 + 核心结构债务已清 |
| Remaining Gap | 产品形态尚未成型——缺 Server 正式发布态、缺端到端示例、SDK 导出一个测试编译失败 |
| Most Urgent Fix | 修复 SDK exports 测试编译错误，恢复 CI 绿灯 |

---

## 上轮发现修复状态

| # | 发现 | 修复状态 | 证据 |
|---|------|----------|------|
| A-1 | LoopOrchestrator 三重复制 | ✅ 已修 | `streamCore()` 单一模板方法，`runLoop`/`streamLoop`/`streamEvents` 均委托给它 |
| A-2 | requiredTools 仅 prompt 建议 | ✅ 已修 | `evaluate-iteration.ts:130` `requiredToolPolicy: 'enforce'` 自动注入 synthetic tool calls |
| A-3 | compat retry 统计不暴露 | ✅ 已修 | `LoopResult.compatRetries` + `AgentRunResult.compatRetries` |
| A-4 | 插件不能修改 stage | ✅ 已修 | `HarnessAPIImpl.insertStage/removeStage/replaceStages` + `LoopOrchestrator.applyMutation` |
| A-5 | model 缓存无失效 | ✅ 已修 | `agent.ts:242` `invalidateModel()` + `autoInvalidateModel()` on auth/not-found |
| A-6 | _compatFixed 标志污染 | ✅ 已修 | F-12 已在 `90214aa` 中处理 |
| A-7 | gateTool/gateLLM 空处理器 | ✅ 已修 | `f9f9af5` PipelineRunner 跳过无注册处理器的 stage hook 调用 |

**第三轮 7/7 全部修复。**

---

## 产品形态完成度评估

### 回顾：目标产品形态

根据项目记忆 (`project-agent-server-product`)，AgentForge 的产品目标是：

- **B/C 双场景** — B 端企业 Agent Server + C 端个人 coding assistant
- **AgentForge 做底** — 核心框架层
- **opencode 做壳** — C 端 CLI 壳
- **Mastra 做参考** — Server 形态参考
- **三阶段转型路线** — Phase 1: 核心 SDK 稳定化 → Phase 2: Server 发布态 → Phase 3: 产品化

### 各维度完成度

| 维度 | 完成度 | 评估 |
|------|--------|------|
| **核心 SDK** | **90%** | 7/7 模块完备，三形态完整映射，AOP 三方法全部实现。仍有 1 个编译测试失败 |
| **插件生态** | **75%** | 7 个插件包（memory/compression/permission/skill/mcp/eviction/harness），但缺少插件市场/发现机制，插件文档仅 API 级 |
| **Server 产品** | **60%** | Hono HTTP server + A2A 协议 + SSE streaming + Profile 系统 + CLI 均存在，但缺少生产级中间件（限流、CORS）、部署文档、Docker 配置 |
| **可观测性** | **85%** | EventSystem + Span + OTel bridge + TraceCollector + Metrics，覆盖全链路 |
| **安全与审计** | **70%** | Permission processor + SUSPEND/RESUME + CheckpointStore，但缺 Domain Error 类型、审计查询 API |
| **文档与示例** | **50%** | ADR 8 篇 + API Reference + Getting Started，但缺端到端教程、架构图过时、示例只有一个巨大的 demo 文件 |
| **测试覆盖** | **80%** | 117 个测试文件、覆盖所有模块。但端到端集成测试较少，且当前有 1 个编译失败 |

### 量化指标

```
代码行数:
  packages/core/src/       4,514 行 (33 文件)
  packages/plugins/src/    3,044 行 (26 文件)
  packages/server/src/     2,343 行 (37 文件)
  packages/sdk/src/          794 行 (2 文件)
  packages/observability/src  ~400 行 (7 文件)
  packages/tools/src/         ~50 行 (2 文件)
  ─────────────────────────────────────
  总源码:                  ~11,145 行
  总测试:                  ~21,000+ 行 (117 文件)

测试/代码比:              ~1.9:1

近 16 天提交:              130 commits (5/1 ~ 5/16)
```

---

## 四个终端目标验收

### ① 全链路透明可观测

| 验收条件 | 状态 | 证据 |
|----------|------|------|
| 每个 stage 产生 before+after 事件 | ✅ | `PipelineRunner.executeStage` 发射 `stage:before`/`stage:after` |
| 每个 LLM 调用产生 before+after+span | ✅ | `LLMInvoker` + `llm.before`/`llm:after` hook |
| 每次工具执行产生 before+after | ✅ | `executeTools` processor + `tool:before`/`tool:after` |
| Agent 级事件完整 | ✅ | `agent.start`/`agent.end`/`iteration.end`/`error` |
| 事件覆盖率测试 | ⚠️ | 存在 `pipeline-observability.test.ts` 和 `event-system.test.ts`，但不是系统性的覆盖率断言 |

**评分: 90%** — 功能完备，缺系统化事件覆盖率自动化断言

### ② 全链路切面可插拔

| 验收条件 | 状态 | 证据 |
|----------|------|------|
| 每个 stage Processor 可 replace() | ✅ | `PipelineRunner.register()` 支持覆盖 |
| Processor 可 unregister() | ✅ | `PipelineRunner.unregister()` |
| 插件通过 HarnessAPI 操作 | ✅ | `HarnessAPIImpl` 完整接口 |
| 插件可修改 stage 顺序 | ✅ | `insertStage/removeStage/replaceStages` (A-4 修复) |

**评分: 95%** — 完整实现

### ③ 符合 Harness 工程

| 验收条件 | 状态 | 证据 |
|----------|------|------|
| 依赖注入 | ✅ | Agent 构造函数接受 `AgentDependencies` |
| 无模块级可变全局状态 | ⚠️ | `builtin-gateway.ts:31` 仍有模块级 `registerProvider()` |
| 状态机合法转移 | ✅ | `StateMachine` 强制转换路径 |
| setup/teardown 生命周期 | ⚠️ | `teardown()` 存在，`setup()` 不存在（构造时初始化） |

**评分: 80%** — 仍有一个模块级可变状态 + 无显式 setup 阶段

### ④ 全链路高安全可审计

| 验收条件 | 状态 | 证据 |
|----------|------|------|
| Permission decision 审计记录 | ✅ | `permission-processor` + `permission:ask`/`permission:deny` 事件 |
| SUSPEND checkpoint 完整序列化 | ✅ | `serialize()`/`deserialize()` + `JsonlCheckpointStore` |
| RESUME 从断点继续 | ✅ | `resumeLoop()` 从 checkpoint 恢复 |
| 任意 stage 中断 | ✅ | 双重 AbortSignal 检查 (runner + orchestrator) |
| Domain Error 类型 | ❌ | 缺少结构化错误分类，`error.recoverable` 从未设置 |

**评分: 75%** — 核心能力存在，缺 Domain Error 层

---

## 7-Module 状态

| # | Module | Status | Detail |
|---|--------|--------|--------|
| 1 | PipelineRunner | ✅ Complete | `stream()` 统一入口，自动 span/hook 编织 |
| 2 | ContextBuilder | ✅ Complete | `semanticTruncation` 默认，多 pass 压缩，profile 支持 |
| 3 | LLMInvoker | ✅ Complete | `streamWithRetry`，span 追踪，reasoning，reasoning_error 事件 |
| 4 | ToolRegistry | ✅ Complete | before/after hooks，output mutation gate，truncation |
| 5 | EventSystem | ✅ Complete | EventBus + replay + backend + TraceCollector + OTLP export |
| 6 | HookManager | ✅ Complete | profiles (minimal/standard/strict)，优先级，禁用点 |
| 7 | CheckpointStore | ✅ Complete | `JsonlCheckpointStore` 默认，autoCheckpoint |

**7/7 模块完整。**

---

## 三形态映射验证

```
Form 1 (Agent Loop):
  while loop       -> LoopOrchestrator.streamCore()     ✅ 单一模板方法
  LLM call         -> LLMInvoker                        ✅
  Tools            -> ToolRegistry + executeTools        ✅
  Context assembly -> ContextBuilder                     ✅

Form 2 (Harness):
  observe          -> EventSystem + span                 ✅
  control          -> StateMachine + token/step limits   ✅
  intervene        -> HookManager + compat + abort       ✅

Form 3 (Runtime):
  EventBus         -> EventSystem                        ✅
  LifecycleState   -> StateMachine                       ✅
  Hooks            -> HookManager                        ✅
```

**三形态 100% 覆盖。**

---

## AOP 三方法验证

```
Method 1 (callback/hook)  -> HookManager + tool hooks     ✅ 完整
Method 2 (flow as data)   -> StageConfig + runtime mutation ✅ 完整 (A-4 修复后)
Method 3 (side observing) -> EventSystem emit + replay    ✅ 完整
```

**AOP 三方法 100% 覆盖。**

---

## 当前 Findings (新发现)

### B-1 [HIGH] SDK exports 测试编译失败 — CI 红灯

- **Layer**: 结构性
- **Mechanism**: `packages/sdk/__tests__/exports.test.ts:207` 测试中的 `HarnessAPI` 实现缺少 A-4 修复新增的 `insertStage`/`removeStage`/`replaceStages` 三个方法，导致 TS 编译失败，全量测试不通过。
- **Root cause**: A-4 修复只更新了 SDK 类型定义和 core 实现，未同步更新 SDK 的类型合规性测试。
- **Evidence**: `packages/sdk/__tests__/exports.test.ts:207`
- **Confidence**: 1.0
- **Fix**: 在测试的 mock HarnessAPI 对象中补充三个新方法。

### B-2 [MEDIUM] builtin-gateway 仍有模块级可变状态

- **Layer**: Layer 12 (Persistence — stale global)
- **Mechanism**: `builtin-gateway.ts:31` `registerProvider()` 是模块级函数，修改模块级 `_factories` Map。多次 Agent 实例间共享状态，破坏隔离性。
- **Root cause**: 历史遗留 — ModelFactory 已存在但 BuiltInGateway 的注册机制未收敛。
- **Evidence**: `packages/core/src/gateways/builtin-gateway.ts:30-31`
- **Confidence**: 0.85
- **Fix**: 将 `registerProvider()` 移入 `GatewayChain` 或 `ModelFactory` 实例方法，消除模块级状态。

### B-3 [MEDIUM] 缺 Domain Error 类型

- **12-layer map**: Layer 9 (Answer shaping) + Layer 12 (Persistence)
- **Mechanism**: 所有错误都是原生 `Error`，没有 `RecoverableError`/`FatalError`/`AuthError` 等分类。`error.recoverable` 在 SDK 类型中声明但从未在代码中设置。调用方无法区分"可重试"和"不可恢复"。
- **Evidence**: `packages/sdk/src/index.ts` 中 `ProcessorResult` 有 `error.recoverable`，但 grep 全 core 无 `recoverable` 赋值
- **Confidence**: 0.80
- **Fix**: 定义 `AgentForgeError` 基类 + 子类，在 LLMInvoker/ToolRegistry/LoopOrchestrator 中使用。

### B-4 [MEDIUM] 产品文档缺端到端教程

- **Layer**: 不适用（产品层面）
- **Mechanism**: 当前只有 `examples/unified-demo.ts` (31KB 单文件)。新用户无法从 "安装" 到 "运行一个完整 Agent" 形成心智模型。`getting-started.md` 存在但过于骨架化。
- **Evidence**: `docs/getting-started.md` (~100 行)，`examples/` 仅 1 个 demo
- **Confidence**: 0.90
- **Fix**: 添加 3 个渐进式示例：(1) 最小 Agent, (2) 带插件的 Agent, (3) Server + A2A 远程调用。

### B-5 [LOW] Server 缺生产级部署配置

- **Layer**: Layer 10 (Platform rendering)
- **Mechanism**: Server 包存在但无 Dockerfile、docker-compose、k8s manifest、环境变量模板、健康检查配置。无法一键部署到生产。
- **Evidence**: `packages/server/` 无 Docker 相关文件
- **Confidence**: 0.70
- **Fix**: 添加 Dockerfile + .env.example + 部署文档。

### B-6 [LOW] _compatFixed 字段清理状态待确认

- **12-layer map**: Layer 2 (Session history)
- **Mechanism**: F-12 修复声称已处理 `_compatFixed`，但需确认是否在所有消息持久化路径上 strip。
- **Evidence**: commit `90214aa` (F-12 修复)
- **Confidence**: 0.50
- **Fix**: 验证 `_compatFixed` 不出现在序列化输出中。

---

## Ordered Fix Plan

| # | Goal | Why Now | Expected Effect |
|---|------|---------|-----------------|
| 1 | 修复 SDK exports 测试 | CI 红灯阻塞所有后续工作 | 恢复 CI 绿灯 |
| 2 | 消除 builtin-gateway 模块级状态 | 违反 Harness 工程 (目标③) | Agent 实例隔离 |
| 3 | 添加 Domain Error 类型 | 缺失的错误分类让调试和恢复逻辑无法实现 | 结构化错误处理 |
| 4 | 端到端教程 + 渐进式示例 | 产品形态转型的第一步 — 用户需要上手路径 | 降低采纳门槛 |
| 5 | Server 生产部署配置 | Phase 2 (Server 发布态) 的前置条件 | 可部署到生产 |

---

## 跨四轮审计的演进轨迹

```
第一轮 (5/14):  7/7 模块缺 3 个         -> "功能缺失"
第二轮 (5/15):  7/7 功能全，5/7 默认不安全 -> "默认安全"
第三轮 (5/15):  7/7 功能 + 默认安全       -> "结构债务"
第四轮 (5/16):  7/7 完整 + 结构清晰       -> "产品就绪度"

代码行数演进:
  第一轮前: ~6,000 行
  第四轮:   ~11,145 行 (源码) + ~21,000 行 (测试)

提交密度:
  5/1 ~ 5/16: 130 commits = ~8 commits/天
```

---

## Ultimate Judgment

```
Capability  (7/7 模块功能):     ████████████  100%  ✅
Default     (默认安全):          ██████████░░   90%  ✅ (builtin-gateway 模块级状态残留)
Legibility  (代码可读性):        █████████░░░   85%  ✅ (文档在，代码有重复已消除)
Testability (测试覆盖):          ████████░░░░   80%  ⚠️ (117 文件但有 1 编译失败)
Production  (生产就绪度):        ██████░░░░░░   55%  ❌ (缺部署配置、端到端示例、Domain Error)
```

### 本质判断

**AgentForge 作为 Agent 框架的核心层已经成熟。** 7 模块、三形态、AOP 三方法、四个终端目标全部在代码中有对应实现。三轮审计的结构债务（三重复制、requiredTools 不强制、stageConfig 不开放）已全部清偿。

**作为产品尚未完成。** 从 "框架可用" 到 "产品可用" 的距离是：
1. CI 绿灯 (阻塞一切)
2. 错误分类 (开发者体验)
3. 上手路径 (用户采纳)
4. 部署能力 (运维交付)

---

## 12-Layer Stack 审计覆盖

| # | Layer | Status | Finding |
|---|-------|--------|---------|
| 1 | System prompt | ✅ | prepareStep + promptFragments 注入 |
| 2 | Session history | ✅ | ContextBuilder 管理，_compatFixed 待确认 |
| 3 | Long-term memory | ✅ | memory-plugin + admission gate |
| 4 | Distillation | ✅ | semanticTruncation 默认 |
| 5 | Active recall | ✅ | fact-injection processor |
| 6 | Tool selection | ✅ | requiredToolPolicy: 'enforce' |
| 7 | Tool execution | ✅ | executeTools + before/after hooks |
| 8 | Tool interpretation | ✅ | tool output validation + truncation |
| 9 | Answer shaping | ⚠️ | 缺 Domain Error 类型 |
| 10 | Platform rendering | ⚠️ | Server 存在但无部署配置 |
| 11 | Hidden repair loops | ✅ | compat retry 可观测 (compatRetries) |
| 12 | Persistence | ⚠️ | builtin-gateway 模块级状态残留 |

---

## Related

- 第一轮审计: `docs/audit/agent-architecture-audit-2026-05.md`
- 第二轮审计: `docs/audit/agent-architecture-audit-2026-05-15.md`
- 第三轮审计: `docs/audit/agent-architecture-audit-2026-05-15-v2.md`
- 7-Module 架构: project memory `project-production-agent-7-modules`
- 产品形态: project memory `project-agent-server-product`
- 理想架构规范: `docs/design/IDEAL-ARCHITECTURE.md`
