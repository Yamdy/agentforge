# AgentForge Documentation

> 统一文档索引 - 所有设计、分析、计划、指南文档的导航入口

---

## 📚 文档分类

### 🏗️ 设计文档 (`design/`)

核心架构设计文档，包含事件流、类型系统、插件系统等完整设计。

| 文档 | 描述 |
|------|------|
| [README.md](./design/README.md) | 设计文档索引 - 完整的文档导航 |
| [00-OVERVIEW.md](./design/00-OVERVIEW.md) | 设计理念、核心思想、为什么是 RxJS + Zod |
| [harness.md](./design/harness.md) | **Agent Harness 核心概念** — E/T/C/S/L/V 六大工程要件 |
| [01-CORE-TYPES.md](./design/01-CORE-TYPES.md) | 事件类型定义（40 种事件 Schema）、Agent 状态定义 |
| [02-ZOD-CONTRACT.md](./design/02-ZOD-CONTRACT.md) | Zod 数据契约层、信任度分级模型 |
| [03-DI.md](./design/03-DI.md) | 轻量依赖注入、依赖倒置、三层 Context 结构 |
| [04-PROMPT-BUILDER.md](./design/04-PROMPT-BUILDER.md) | Prompt 构建、Zod → FunctionDefinition 转换 |
| [05-EVENT-STREAM.md](./design/05-EVENT-STREAM.md) | 📦 已归档（RxJS Observable 模式已移除） |
| [06-FLOW-CONSTRAINTS.md](./design/06-FLOW-CONSTRAINTS.md) | 流层陷阱与约束、生命周期管理、异步竞态 |
| [07-PLUGIN-SYSTEM.md](./design/07-PLUGIN-SYSTEM.md) | Hook + 插件系统、拦截器 vs 观察器 |
| [08-SUBSYSTEMS.md](./design/08-SUBSYSTEMS.md) | 子系统扩展、SubAgent/MCP/Workflow 集成 |
| [09-A2A.md](./design/09-A2A.md) | A2A 智能体互联、消息信封标准化 |
| [10-FEATURES.md](./design/10-FEATURES.md) | 特性实现：可观测、可中断、可恢复、重试、超时 |
| [11-OPERATORS.md](./design/11-OPERATORS.md) | 操作符库：控制流、变换、通知、组合操作符 |
| [12-API-DESIGN.md](./design/12-API-DESIGN.md) | API 设计：L1 零代码、L2 配置式、L3 编程式 |
| [13-EXAMPLES.md](./design/13-EXAMPLES.md) | 使用示例：最简使用、带操作符、可中断、可恢复 |
| [14-OBSERVABILITY.md](./design/14-OBSERVABILITY.md) | 可观测与管控：全链路埋点、状态机、配置热更新 |
| [15-ARCHITECTURE.md](./design/15-ARCHITECTURE.md) | 架构总览图、迁移路径、实施路线图 |
| [16-CONFIG-MODULE.md](./design/16-CONFIG-MODULE.md) | 配置模块设计、Schema 定义、Profile 系统 |
| [17-SECURITY.md](./design/17-SECURITY.md) | 安全模块：权限系统、输入清洗、审计日志 |
| [18-QUOTA-INTEGRATION.md](./design/18-QUOTA-INTEGRATION.md) | Quota 集成到 Agent Loop — 成本控制 |
| [19-EVENT-ROUTING.md](./design/19-EVENT-ROUTING.md) | 事件路由补全 — MCP/Workflow/Compaction 生命周期 |
| [20-PUBLISH-READINESS.md](./design/20-PUBLISH-READINESS.md) | 发布就绪性 — API 导出补全 + package.json 配置 |

---

### 📊 分析文档 (`analysis/`)

框架对比分析文档，对比 AgentForge 与主流 Agent 框架。

| 文档 | 描述 |
|------|------|
| [README.md](./analysis/README.md) | 分析文档索引 |
| [analysis_agentforge.md](./analysis/analysis_agentforge.md) | AgentForge 项目深度分析报告 |
| [analysis_agentforge_gap.md](./analysis/analysis_agentforge_gap.md) | AgentForge 模块差距分析 |
| [analysis_agentscope.md](./analysis/analysis_agentscope.md) | AgentScope 项目深度分析报告 |
| [analysis_comparison.md](./analysis/analysis_comparison.md) | AI Agent 框架对比分析报告 |
| [analysis_deepagents.md](./analysis/analysis_deepagents.md) | Deep Agents 项目深度分析报告 |
| [analysis_intersection_complement.md](./analysis/analysis_intersection_complement.md) | AI Agent 框架交集、补集与增强分析 |
| [analysis_mastra.md](./analysis/analysis_mastra.md) | Mastra 项目深度分析报告 |
| [analysis_openharness.md](./analysis/analysis_openharness.md) | OpenHarness 项目分析报告 |

---

### 🏛️ 架构文档 (`architecture/`)

架构改进设计文档，基于框架对比分析的增量改进方案。

| 文档 | 描述 |
|------|------|
| [README.md](./architecture/README.md) | 架构文档索引 |
| [index.md](./architecture/index.md) | 架构文档索引 |
| [LLM-IO-IMPROVEMENTS-DESIGN.md](./architecture/LLM-IO-IMPROVEMENTS-DESIGN.md) | LLM I/O 改进详细设计 |

---

### 📖 用户指南 (`guide/`)

用户指南文档，帮助开发者快速上手 AgentForge。

| 文档 | 描述 |
|------|------|
| [index.md](./guide/index.md) | 用户指南索引 |
| [getting-started.md](./guide/getting-started.md) | 快速开始指南 |
| [core-concepts.md](./guide/core-concepts.md) | 核心概念 |
| [events.md](./guide/events.md) | 事件系统 |
| [state.md](./guide/state.md) | 状态管理 |
| [tools.md](./guide/tools.md) | 工具定义 |
| [plugins.md](./guide/plugins.md) | 插件系统 |
| [mcp.md](./guide/mcp.md) | MCP 集成 |
| [subagent.md](./guide/subagent.md) | 子 Agent |
| [workflow.md](./guide/workflow.md) | 工作流 |
| [memory.md](./guide/memory.md) | 记忆系统 |
| [quota.md](./guide/quota.md) | 配额控制 |

---

### 📋 API 参考 (`api/`)

API 参考文档，详细的 API 接口说明。

| 文档 | 描述 |
|------|------|
| [index.md](./api/index.md) | API 索引 |
| [create-agent.md](./api/create-agent.md) | createAgent API |
| [events.md](./api/events.md) | 事件 API |
| [state.md](./api/state.md) | 状态 API |
| [tool-definition.md](./api/tool-definition.md) | 工具定义 API |
| [llm-adapter.md](./api/llm-adapter.md) | LLM 适配器 API |
| [operators-control.md](./api/operators-control.md) | 控制流操作符 |
| [operators-transform.md](./api/operators-transform.md) | 变换操作符 |
| [operators-notify.md](./api/operators-notify.md) | 通知操作符 |
| [presets.md](./api/presets.md) | 预设配置 |
| [logger.md](./api/logger.md) | 日志 API |
| [quickstart.md](./api/quickstart.md) | 快速开始 API |

---

### 📝 开发计划 (`plans/`)

开发计划文档，功能实现计划与实施路线图。

| 文档 | 描述 | 状态 |
|------|------|------|
| [README.md](./plans/README.md) | 计划文档索引 | - |
| [p0-design.md](./plans/p0-design.md) | P0 设计方案：Google/Ollama 适配器 + 记忆持久化 | 📝 待审查 |
| [p1-http-design.md](./plans/p1-http-design.md) | P1 设计方案：HTTP 适配器实现 | 📝 待审查 |
| [AUDIT-FIX-PLAN.md](./plans/AUDIT-FIX-PLAN.md) | 设计符合性审计修复计划 | ✅ 已完成 |
| [2026-04-27-studio-phase0.md](./plans/2026-04-27-studio-phase0.md) | Studio Phase 0: SSE Bridge 实施计划 | 📝 待实施 |
| [2026-04-27-mcp-integration.md](./plans/2026-04-27-mcp-integration.md) | MCP Client 集成实施计划 | 📝 待实施 |
| [2026-04-27-mpu-wiring.md](./plans/2026-04-27-mpu-wiring.md) | MPU Dead Slots 接线计划 | 📝 待实施 |
| [2026-04-26-create-agentforge-cli.md](./plans/2026-04-26-create-agentforge-cli.md) | create-agentforge CLI 实施计划 | 📝 待实施 |

---

### 📐 规格文档 (`specs/`)

详细设计规格与技术规范。

| 文档 | 描述 |
|------|------|
| [README.md](./specs/README.md) | 规格文档索引 |
| [studio-design.md](./specs/studio-design.md) | AgentForge Studio 设计文档 |

---

### 📁 项目管理 (`project/`)

项目管理文档，项目状态、交接记录、差距分析。

| 文档 | 描述 |
|------|------|
| [README.md](./project/README.md) | 项目管理文档索引 |
| [handoff.md](./project/handoff.md) | 项目交接文档 |
| [framework-gaps-summary.md](./project/framework-gaps-summary.md) | 框架差距总结 |

---

## 🎯 按角色阅读

| 角色 | 推荐阅读顺序 |
|------|-------------|
| **技术负责人** | design/00 → design/06 → design/15 → design/01 → design/02 → design/03 |
| **应用开发者** | guide/getting-started → guide/core-concepts → api/quickstart → api/create-agent |
| **框架开发者** | design/01 → design/02 → design/03 → design/04 → design/05 → design/07 → design/08 |
| **运维人员** | design/14 → design/06 → design/10 |

---

## 📊 文档统计

| 分类 | 数量 | 说明 |
|------|------|------|
| 设计文档 | 21 | 核心架构设计 |
| 分析文档 | 8 | 框架对比分析 |
| 架构文档 | 2 | 架构改进设计 |
| 用户指南 | 13 | 用户指南 |
| API 参考 | 12 | API 参考 |
| 开发计划 | 7 | 开发计划 |
| 规格文档 | 1 | 设计规格 |
| 项目管理 | 2 | 项目管理 |
| **总计** | **66** | - |
