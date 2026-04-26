# AgentForge 事件流架构设计

> 设计日期: 2026-04-24
> 最后更新: 2026-04-26 (P0 安全架构设计)
> 状态: **已实现**
> 核心理念: RxJS 事件流 + Zod 类型安全 = Agent 框架底座

---

## 文档索引

### 基础概念

| 文档 | 描述 |
|------|------|
| [00-OVERVIEW.md](./00-OVERVIEW.md) | 设计理念、核心思想、为什么是 RxJS + Zod、落地铁律 |
| [01-CORE-TYPES.md](./01-CORE-TYPES.md) | 事件类型定义（40 种事件 Schema）、Agent 状态定义、检查点定义 |

### 核心架构

| 文档 | 描述 |
|------|------|
| [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) | Zod 数据契约层、信任度分级模型（Tier 1/2/3）、校验策略 |
| [03-DI.md](./03-DI.md) | 轻量依赖注入、依赖倒置、三层 Context 结构、ContextBuilder |
| [04-PROMPT-BUILDER.md](./04-PROMPT-BUILDER.md) | Prompt 构建、Zod → FunctionDefinition 转换、Skill 分类与动态注入 |
| [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) | 事件流底座、Observable<AgentEvent>、Agent Loop 核心模式 |

### 约束与保障

| 文档 | 描述 |
|------|------|
| [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) | 流层陷阱与约束、生命周期管理、异步竞态、错误边界、背压策略 |
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
| [12-API-DESIGN.md](./12-API-DESIGN.md) | API 设计：L1 零代码、L2 配置式、L3 编程式三层 API |

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
| **生产就绪** | 06, 14, 15, 07 (安全整合) |
| **安全合规** | 17, 07, 06, 10 |

---

## 核心铁律速查

### 架构层（技术负责人必背）

| # | 铁律 |
|---|------|
| 1 | RxJS 管好订阅与销毁，杜绝内存泄漏 |
| 2 | Zod 统一全链路数据契约，防脏数据、防协议崩坏 |
| 3 | 轻量 DI 解耦所有外部能力，方便替换与扩展 |
| 4 | Hook 插件异常隔离，横向能力零侵入 |
| 5 | 分层设计、作用域隔离 |
| 6 | 流程串行严格管控，副作用异步并行 |

### 实现层（开发者必背）

| # | 铁律 |
|---|------|
| 1 | 严格隔离同步事务代码，不在 RxJS 流里写强同步锁 |
| 2 | 全局统一 `destroy$ + takeUntil`，禁止裸订阅 |
| 3 | 插件钩子强制独立 try/catch，禁止击穿主流程 |
| 4 | 核心主流程 `concatMap` 串行，副作用 `mergeMap` 并行 |
| 5 | 内部可信数据简化 Zod，外部 LLM/三方输入强校验 |
| 6 | 封装统一流调试工具：链路ID、阶段打点、流状态快照 |

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
| **API 层** | 12-API-DESIGN.md | `src/api/*.ts` | ✅ 已实现 |
| **配置模块** | 16-CONFIG-MODULE.md | `src/core/config/*.ts` | 📝 设计完成 |
| **安全架构** | 17-SECURITY.md | `src/security/` | 🔧 评审中 (5决策已确认，3缺口已补强) |
| **Quota 集成** | 18-QUOTA-INTEGRATION.md | `src/quota/*.ts` | 📝 模块存在，待集成到主循环 |
| **事件路由补全** | 19-EVENT-ROUTING.md | `src/loop/agent-loop.ts` | 📝 待评审 |
| **发布就绪性** | 20-PUBLISH-READINESS.md | `src/index.ts`, `package.json` | 📝 待评审 |
| **P1: 规划/执行分离** | 08-SUBSYSTEMS.md | - | 🔮 未实现 |
| **P1: outputSchema** | 01-CORE-TYPES.md | - | 🔮 未实现 |
| **P1: 决策追溯** | 01-CORE-TYPES.md | - | 🔮 未实现 |
| **P1: 外部状态机** | 01-CORE-TYPES.md | - | 🔮 未实现 |
| **P2: Working Memory** | 01-CORE-TYPES.md | - | 🔮 未实现 |
| **P2: Evaluation** | 14-OBSERVABILITY.md | - | 🔮 未实现 |
| **P2: RAG** | 08-SUBSYSTEMS.md | - | 🔮 未实现 |
| **P2: Deployment** | 15-ARCHITECTURE.md | - | 🔮 未实现 |
