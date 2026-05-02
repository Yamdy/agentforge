# AgentForge 事件流架构设计

> 设计日期: 2026-04-24
> 最后更新: 2026-04-26 (P0 安全架构设计)
> 状态: **已实现**
> 核心理念: 命令式事件驱动 + Zod 类型安全 = Agent 框架底座

---

## 文档索引

### 基础概念

| 文档 | 描述 |
|------|------|
| [00-OVERVIEW.md](./00-OVERVIEW.md) | 设计理念、核心思想、为什么是 RxJS + Zod、落地铁律 |
| [harness.md](./harness.md) | **Agent Harness 核心概念** — E/T/C/S/L/V 六大工程要件、行业定位、伪陷阱规避 |
| [01-CORE-TYPES.md](./01-CORE-TYPES.md) | 事件类型定义（40 种事件 Schema）、Agent 状态定义、检查点定义 |

### 核心架构

| 文档 | 描述 |
|------|------|
| [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) | Zod 数据契约层、信任度分级模型（Tier 1/2/3）、校验策略 |
| [03-DI.md](./03-DI.md) | 轻量依赖注入、依赖倒置、三层 Context 结构、ContextBuilder |
| [04-PROMPT-BUILDER.md](./04-PROMPT-BUILDER.md) | Prompt 构建、Zod → FunctionDefinition 转换、Skill 分类与动态注入 |
| 📦 [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) | 已归档 → `docs/archive/rxjs/`（RxJS Observable 已移除） |

### 约束与保障

| 文档 | 描述 |
|------|------|
| 📦 [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) | 已归档（RxJS 流约束已不再适用） |
| [07-PLUGIN-SYSTEM.md](./07-PLUGIN-SYSTEM.md) | Hook + 插件系统、拦截器 vs 观察器、插件接口定义、生命周期管理 |

### 扩展能力

| 文档 | 描述 |
|------|------|
| [08-SUBSYSTEMS.md](./08-SUBSYSTEMS.md) | 子系统扩展、SubAgent/MCP/Workflow 集成、Skill 知识包、事件冒泡规则 |
| [09-A2A.md](./09-A2A.md) | A2A 智能体互联、消息信封标准化、传输层抽象、客户端/服务器设计 |

### 功能实现

| 文档 | 描述 |
|------|------|
| [10-FEATURES.md](./10-FEATURES.md) | 特性实现：可观测、可中断、可恢复、重试、超时、打点、HITL |
| [11-OPERATORS.md](./11-OPERATORS.md) | 操作符库：控制流、变换、通知、组合操作符 |
| [12-API-DESIGN.md](./12-API-DESIGN.md) | 📦 已归档（含旧 Observable API 示例） |

### 使用与运维

| 文档 | 描述 |
|------|------|
| [13-EXAMPLES.md](./13-EXAMPLES.md) | 使用示例：最简使用、带操作符、可中断、可恢复、HITL、生产环境 |
| [14-OBSERVABILITY.md](./14-OBSERVABILITY.md) | 可观测与管控：全链路埋点、状态机、配置热更新、管道模板、上下文压缩 |

### 安全与基础设施

| 文档 | 描述 |
|------|------|
| [16-CONFIG-MODULE.md](./16-CONFIG-MMODULE.md) | 配置模块设计、Schema 定义、Profile 系统、热更新支持 |
| [17-SECURITY.md](./17-SECURITY.md) | 安全模块：权限系统、输入清洗、审计日志、沙箱执行、限流 |
| [18-QUOTA-INTEGRATION.md](./18-QUOTA-INTEGRATION.md) | Quota 集成到 Agent Loop — 成本控制 |
| [19-EVENT-ROUTING.md](./19-EVENT-ROUTING.md) | 事件路由补全 — MCP/Workflow/Compaction 等生命周期事件 |
| [20-PUBLISH-READINESS.md](./20-PUBLISH-READINESS.md) | 发布就绪性 — API 导出补全 + package.json 配置 |
| [21-TOKEN-BUDGET.md](./21-TOKEN-BUDGET.md) | **Token 预算 + 递减收益检测** — 参考 ClaudeCode 实现 |
| [22-ERROR-RECOVERY.md](./22-ERROR-RECOVERY.md) | **分级错误恢复** — max_output_tokens/prompt_too_long/model_overloaded |
| [23-TOOL-CONCURRENCY.md](./23-TOOL-CONCURRENCY.md) | **Per-Tool 并发安全判定** — isConcurrencySafe() + 工具分批执行 |
| [24-ARCH-REFACTOR.md](./24-ARCH-REFACTOR.md) | ✅ **已完成** — Imperative 循环 + Hook 切面（参考 ClaudeCode + OpenCode） |
| [25-DE-RXJS.md](./25-DE-RXJS.md) | ✅ **已完成** — 移除 RxJS，全栈重构，事件类型 50+→18，依赖消除 |
| [27-IMPLEMENTATION-PLAN.md](./27-IMPLEMENTATION-PLAN.md) | ✅ **已完成** — 6 Phase 逐文件变更指南已执行完毕 |

### 总览

| 文档 | 描述 |
|------|------|
| [15-ARCHITECTURE.md](./15-ARCHITECTURE.md) | 架构总览图、迁移路径、实施路线图 |

---

## 快速导航

### 按角色阅读

| 角色 | 推荐阅读顺序 |
|------|-------------|
| **技术负责人** | 00 → 06 → 15 → 01 → 02 → 03 |
| **应用开发者** | 12 → 13 → 10 → 11 → 05 |
| **框架开发者** | 01 → 02 → 03 → 04 → 05 → 07 → 08 |
| **运维人员** | 14 → 06 → 10 |

### 按主题阅读

| 主题 | 相关文档 |
|------|---------|
| **类型安全** | 01, 02 |
| **依赖注入** | 03, 04 |
| **事件流** | 05, 06, 10 |
| **插件扩展** | 07, 08 |
| **分布式通信** | 09 |
| **生产就绪** | 06, 14, 15, 07 (安全整合), 21, 22, 23 |
| **安全合规** | 17, 07, 06, 10 |

---

## 核心铁律速查

> 完整铁律体系见 [00-OVERVIEW.md](./00-OVERVIEW.md)（14 条：5 架构 + 5 运行时 + 4 实现，含分级和约束矩阵）

### 架构层

| # | 铁律 |
|---|------|
| A1 | 命令式循环 while(true) + await + AgentEventEmitter |
| A2 | Harness 硬管控，安全校验不可绕过 |
| A3 | Zod 分层数据契约，as any 零容忍 |
| A4 | DI 解耦 + 上下文闭包 |
| A5 | 三层 API（L1/L2/L3）渐进式复杂度 |

### 运行时

| # | 铁律 |
|---|------|
| R1 | 错误即事件，不 throw |
| R2 | Hook 异常隔离，不击穿 |
| R3 | 工具调用必经注册表 |
| R4 | 主流程串行，副作用并行 |
| R5 | 状态外部化，可中断恢复 |

### 实现

| # | 铁律 |
|---|------|
| I1 | 类型安全零容忍（as any / @ts-ignore 视为债务） |
| I2 | ESM + verbatimModuleSyntax，不含 RxJS |
| I3 | 外部输入永远不信任（Zod safeParse 兜底） |
| I4 | 测试即文档 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 |
| v2 | 2026-04-24 | 添加 Skill 分类与 PromptBuilder 动态注入 |
| v3 | 2026-04-24 | 添加流层陷阱与约束：生命周期/竞态/错误边界 |
| v4 | 2026-04-25 | 按模块拆分为独立文档 |
| v5 | 2026-04-25 | HITL Observable 模式：`ask()` 返回 `Observable<string>`，事件 schema 添加 `toolCallId/toolName` |
| v6 | 2026-04-26 | **实现完成**: SubAgent/Workflow/MCP/Memory/Observability 全部实现 |
| v7 | 2026-04-26 | **性能优化**: 修复 O(n²) 算法、并行化 Skill 加载、添加资源清理约束 |
| v8 | 2026-04-26 | **安全架构**: 沙箱隔离/PII脱敏/配额管控/审批流程设计，Harness规范对齐分析 (整合到 06/07/10) |
| v9 | 2026-04-26 | **P1 设计**: 规划/执行分离、outputSchema、决策追溯、外部状态机 (整合到现有文档) |
| v10 | 2026-04-26 | **P2 设计**: Working Memory、Evaluation、RAG、Deployment (整合到现有文档) |
| v11 | 2026-04-26 | **安全模块草稿**: 新增 17-SECURITY.md，记录威胁模型、缺口分析、5子系统设计、关键决策点 |
| v12 | 2026-04-26 | **安全模块评审**: 5个决策点确认、3个关键缺口补强(Args清洗/审计一致性/统一审批通道)、SandboxExecutor接口重构 |
| v13 | 2026-04-26 | **1.0阻塞项设计**: 新增 18-QUOTA-INTEGRATION.md、19-EVENT-ROUTING.md、20-PUBLISH-READINESS.md |
| v14 | 2026-04-26 | **评审修复**: Quota consume/fire-and-forget说明、Event Routing Compaction同步性约束、Publish peerDependencies+prepublishOnly+sideEffects验证 |
| v15 | 2026-04-27 | **Adapter 重构**: 新增 adapter-system.ts (错误分类/重试/Provider注册)，参考 AgentScope/Mastra/OpenCode/DeepAgents |
| v16 | 2026-04-29 | **ClaudeCode 借鉴设计**: 新增 21-TOKEN-BUDGET.md (Token预算+递减收益)、22-ERROR-RECOVERY.md (分级错误恢复)、23-TOOL-CONCURRENCY.md (Per-Tool并发安全) |
| v17 | 2026-04-30 | **架构重构设计**: 新增 24-ARCH-REFACTOR.md (Imperative循环+Hook切面)、25-DE-RXJS.md (移除RxJS全栈重构)、26-FRAMEWORK-COMPARISON.md (6框架横比) |

---

## 实现状态矩阵

| 模块 | 文档 | 实现文件 | 状态 |
|------|------|---------|------|
| **核心事件** | 01-CORE-TYPES.md | `src/core/events.ts` | ✅ 已实现 |
| **状态机** | 01-CORE-TYPES.md | `src/core/state-machine.ts` | ✅ 已实现 |
| **依赖注入** | 03-DI.md | `src/core/context.ts`, `context-builder.ts` | ✅ 已实现 |
| **插件系统** | 07-PLUGIN-SYSTEM.md | `src/plugins/*.ts` | ✅ 已实现 |
| **操作符库** | 11-OPERATORS.md | `src/operators/*.ts` | ✅ 已实现 |
| **Agent Loop** | 05-EVENT-STREAM.md | `src/loop/agent-loop.ts` | ✅ 已实现 |
| **HITL** | 10-FEATURES.md | `src/core/context.ts` (DefaultHITLController) | ✅ 已实现 |
| **Checkpoint** | 01-CORE-TYPES.md | `src/core/checkpoint.ts` | ✅ 已实现 |
| **A2A 协议** | 09-A2A.md | `src/a2a/*.ts` | ✅ 已实现 |
| **Skill 系统** | 08-SUBSYSTEMS.md | `src/skill/*.ts` | ✅ 已实现 |
| **SubAgent** | 08-SUBSYSTEMS.md | `src/subagent/*.ts` | ✅ 已实现 |
| **Workflow** | 08-SUBSYSTEMS.md | `src/workflow/*.ts` | ✅ 已实现 |
| **MCP Client** | 08-SUBSYSTEMS.md | `src/mcp/*.ts` | ✅ 已实现 |
| **CompactionManager** | 14-OBSERVABILITY.md | `src/memory/*.ts` | ✅ 已实现 |
| **ResourceMonitor** | 14-OBSERVABILITY.md | `src/observability/*.ts` | ✅ 已实现 |
| **LLM Adapter** | - | `src/adapters/*.ts` | ✅ 已实现 |
| **Adapter System** | - | `src/adapters/adapter-system.ts` | ✅ 已实现 (错误分类/重试/Provider注册) |
| **API 层** | 12-API-DESIGN.md | `src/api/*.ts` | ✅ 已实现 |
| **配置模块** | 16-CONFIG-MODULE.md | `src/core/config/*.ts` | 📝 设计完成 |
| **安全架构** | 17-SECURITY.md | `src/security/` | 🔧 评审中 (5决策已确认，3缺口已补强) |
| **Quota 集成** | 18-QUOTA-INTEGRATION.md | `src/quota/*.ts` | 📝 模块存在，待集成到主循环 |
| **事件路由补全** | 19-EVENT-ROUTING.md | `src/loop/agent-loop.ts` | 📝 待评审 |
| **发布就绪性** | 20-PUBLISH-READINESS.md | `src/index.ts`, `package.json` | 📝 待评审 |
| **Token 预算** | 21-TOKEN-BUDGET.md | `src/loop/token-budget.ts` | 📝 设计完成 |
| **错误恢复** | 22-ERROR-RECOVERY.md | `src/loop/error-analyzer.ts` | 📝 设计完成 |
| **工具并发安全** | 23-TOOL-CONCURRENCY.md | `src/loop/tool-partition.ts` | 📝 设计完成 |
| **架构重构** | 24-ARCH-REFACTOR.md | `src/core/hooks.ts`, `src/loop/agent-loop.ts` | 📝 设计完成 |
| **移除 RxJS** | 25-DE-RXJS.md | 87 文件 | 📝 设计完成 |
| **框架横比** | 26-FRAMEWORK-COMPARISON.md | — | 📝 设计完成 |
| **P1: 规划/执行分离** | 08-SUBSYSTEMS.md | - | 🔮 未实现 |
| **P1: outputSchema** | 01-CORE-TYPES.md | `src/contracts/tool-output-contract.ts` | ✅ 已实现 |
| **P1: 决策追溯** | 01-CORE-TYPES.md | `src/contracts/decision-trace-storage.ts` | ✅ 已实现 |
| **P1: 外部状态机** | 01-CORE-TYPES.md | - | 🔮 未实现 |
| **P2: Working Memory** | 01-CORE-TYPES.md | - | 🔮 未实现 |
| **P2: Evaluation** | 14-OBSERVABILITY.md | - | 🔮 未实现 |
| **P2: RAG** | 08-SUBSYSTEMS.md | - | 🔮 未实现 |
| **P2: Deployment** | 15-ARCHITECTURE.md | - | 🔮 未实现 |
