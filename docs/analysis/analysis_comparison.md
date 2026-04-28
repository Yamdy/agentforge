# AI Agent 框架对比分析报告

> 分析时间：2026-04-28
> 框架：AgentForge / AgentScope / Deep Agents / Mastra / OpenHarness

---

## 一、项目概览

| 维度 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| **开发者** | Yamdy (个人) | 阿里巴巴通义实验室 | LangChain 官方 | YC W25 孵化 | HKUDS (港大) |
| **语言** | TypeScript | Python | Python | TypeScript | Python |
| **版本** | v0.1.2 | v1.0.19 | SDK v0.5.3 | v1.29.0-alpha.2 | v0.1.7 |
| **许可证** | - | Apache 2.0 | MIT | Apache 2.0 + Enterprise | MIT |
| **定位** | 生产级 Agent 框架 | 企业级多智能体框架 | Agent 运行时 | 全栈 Agent 框架 | Agent 基础设施 |
| **核心理念** | 一切皆事件流 | 释放模型能力 | 开箱即用的 Agent | TypeScript 全栈 | 模型即 Agent |

---

## 二、架构设计对比

| 维度 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| **核心模式** | RxJS 事件流 | 消息驱动 | LangGraph 中间件 | Monorepo 模块化 | Harness 查询引擎 |
| **源文件数** | 155 个 .ts | 215 个 .py | 6 个子包 | 100+ 子包 | 14 个子系统 |
| **API 层次** | L1/L2/L3 三层 | 统一 API | SDK + CLI | SDK + CLI + Server | CLI + TUI |
| **状态管理** | 不可变 AgentState | Msg 消息系统 | LangGraph State | MessageList | QueryEngine |
| **扩展核心** | RxJS 操作符 | Hook + Middleware | 中间件栈 | Provider 注册 | 工具 + 插件 + 技能 |

---

## 三、功能特性全面对比

### 3.1 LLM 提供商支持

| 提供商 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|--------|-----------|------------|-------------|--------|-------------|
| OpenAI | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ✅ | ✅ (默认) | ✅ | ✅ |
| Google Gemini | ⚠️ Stub | ✅ | ✅ | ✅ | ✅ |
| DeepSeek | ✅ (兼容层) | ❌ (通过 OpenAI) | ✅ | ✅ | ✅ |
| 智谱 GLM | ✅ (兼容层) | ❌ | ❌ | ✅ | ✅ |
| 通义千问 | ✅ (兼容层) | ✅ DashScope | ❌ | ✅ | ✅ |
| Ollama | ⚠️ Stub | ✅ | ✅ | ✅ | ✅ |
| **总提供商数** | ~8 | 7 | 20+ | **80+** | 15+ |

### 3.2 工具/函数调用

| 特性 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 工具注册 | ✅ ToolRegistry | ✅ Toolkit | ✅ BaseTool | ✅ createTool | ✅ BaseTool |
| Schema 定义 | ✅ Zod | ✅ Pydantic | ✅ | ✅ Zod | ✅ Pydantic |
| MCP 集成 | ✅ Stdio + HTTP | ✅ | ✅ | ✅ | ✅ Stdio + HTTP |
| 并行工具调用 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 内置工具数量 | 少 | 中等 | 10 个 | 中等 | **43+ 个** |

### 3.3 记忆/上下文管理

| 特性 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 对话历史 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 工作记忆 | ❌ | ✅ (4种) | ❌ | ✅ | ✅ MEMORY.md |
| 长期记忆 | ❌ | ✅ (Mem0/ReMe) | ✅ AGENTS.md | ✅ 语义记忆 | ✅ 跨会话 |
| 记忆压缩 | ✅ 3种策略 | ✅ | ✅ 自动摘要 | ✅ | ✅ Auto-Compact |
| 向量检索 | ❌ | ✅ | ❌ | ✅ | ❌ |

### 3.4 多 Agent 协作

| 特性 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 子 Agent | ✅ 注册表 | ✅ MsgHub | ✅ 三种模式 | ✅ Network | ✅ 生成+委派 |
| 流水线编排 | ✅ Seq/Parallel | ✅ 4种模式 | ❌ | ✅ 图工作流 | ❌ |
| 工作流引擎 | ✅ | ❌ | ❌ | ✅ **最强** | ❌ |
| 团队管理 | ❌ | ❌ | ❌ | ❌ | ✅ team_create |

### 3.5 RAG 能力

| 特性 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 文档处理 | ❌ | ✅ 6种读取器 | ❌ | ✅ | ❌ |
| 向量数据库 | ❌ | ✅ 5种 | ❌ | ✅ **10种** | ❌ |
| Graph RAG | ❌ | ❌ | ❌ | ✅ | ❌ |

### 3.6 安全与权限

| 特性 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 权限控制 | ✅ Policy+Guard | ❌ | ✅ Middleware | ❌ | ✅ **3级模式** |
| 命令黑名单 | ✅ | ❌ | ❌ | ❌ | ✅ |
| 速率限制 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 审计日志 | ✅ 哈希链 | ❌ | ❌ | ❌ | ❌ |
| Docker 沙箱 | ✅ | ❌ | ✅ (多沙箱) | ❌ | ✅ |
| 成本管控 | ✅ Quota | ❌ | ❌ | ❌ | ✅ CostTracker |

### 3.7 语音能力

| 特性 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| TTS | ❌ | ✅ 3提供商 | ❌ | ✅ **14提供商** | ❌ |
| STT | ❌ | ✅ | ❌ | ✅ | ⚠️ 基础 |
| 实时语音 | ❌ | ✅ 3提供商 | ❌ | ✅ | ❌ |

### 3.8 消息通道集成

| 通道 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 飞书 | ❌ | ❌ | ❌ | ❌ | ✅ |
| Slack | ❌ | ❌ | ❌ | ❌ | ✅ |
| Discord | ❌ | ❌ | ❌ | ❌ | ✅ |
| Telegram | ❌ | ❌ | ❌ | ❌ | ✅ |
| 钉钉 | ❌ | ❌ | ❌ | ❌ | ✅ |
| WhatsApp | ❌ | ❌ | ❌ | ❌ | ✅ |

### 3.9 部署方式

| 方式 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| 本地 CLI | ✅ | ✅ | ✅ | ✅ | ✅ |
| 独立服务器 | ❌ | ✅ K8s | ✅ LangGraph | ✅ Hono | ✅ Gateway |
| Next.js 集成 | ❌ | ❌ | ❌ | ✅ | ❌ |
| Cloudflare Workers | ❌ | ❌ | ❌ | ✅ | ❌ |
| 云服务 | ❌ | ✅ Serverless | ✅ LangSmith | ✅ Mastra Cloud | ✅ ohmo |
| GitHub Actions | ❌ | ❌ | ✅ | ❌ | ✅ |

---

## 四、成熟度评估

| 维度 | AgentForge | AgentScope | Deep Agents | Mastra | OpenHarness |
|------|-----------|------------|-------------|--------|-------------|
| **版本阶段** | 早期 (v0.1.2) | 稳定 (v1.0.19) | Beta (v0.5.3) | Alpha (v1.29.0-α) | 早期 (v0.1.7) |
| **架构设计** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **功能完整度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **LLM 覆盖** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **生产就绪** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **社区生态** | ⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 五、各框架最佳适用场景

| 框架 | 最佳场景 |
|------|---------|
| **AgentForge** | 需要强可观测性、可中断/可恢复的 Agent 应用；RxJS 生态项目 |
| **AgentScope** | 企业级多智能体系统，特别是阿里云生态、需要分布式部署和模型微调 |
| **Deep Agents** | 快速获得一个类 Claude Code 的通用 Agent，LangGraph 生态用户 |
| **Mastra** | TypeScript 全栈开发者，需要最全面的功能 |
| **OpenHarness** | 需要多平台消息集成，或想深入理解 Agent Harness 实现 |

---

## 六、总结

- **功能最全面**：🏆 Mastra
- **企业级最强**：🏆 AgentScope
- **安全体系最完善**：🏆 AgentForge
- **生态兼容性最好**：🏆 OpenHarness
- **最快上手**：🏆 Deep Agents

---

*报告生成时间：2026-04-28*
