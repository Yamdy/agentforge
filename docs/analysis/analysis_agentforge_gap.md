# AgentForge 差距分析报告

> 基准：四大框架交集（必须有）+ 各家补集（独门增强）
> 分析时间：2026-04-28

---

## 一、交集对照 — 7 项必备要件逐项检查

| # | 必备要件 | AgentForge 现状 | 达标？ | 差距说明 |
|---|---------|----------------|--------|---------|
| 1 | **Agent Loop** | ✅ `expand()` 递归引擎，流式输出，工具循环，最大步数限制 | ✅ **达标** | 架构优秀，RxJS Observable 模式甚至超越其他框架 |
| 2 | **LLM 统一接口** | ✅ AdapterSystem + ProviderRegistry + 工厂模式 | ⚠️ **基本达标** | Google/Ollama 是 Stub，实际可用仅 OpenAI + Anthropic + 兼容层 |
| 3 | **工具系统 + MCP** | ✅ ToolRegistry + Zod Schema + MCP (stdio + HTTP) | ✅ **达标** | MCP 实现完整，工具适配器齐全 |
| 4 | **记忆/上下文** | ⚠️ 只有压缩策略（truncate/summarize/importance） | ⚠️ **部分达标** | 有压缩，但缺持久化记忆、向量检索、工作记忆 |
| 5 | **子 Agent** | ✅ SubagentRegistry + 父→子委派 + A2A 协议 | ✅ **达标** | A2A 实现甚至比部分框架更完整 |
| 6 | **CLI** | ✅ Commander + Inquirer + 脚手架 | ✅ **达标** | 有 `create-agentforge` 脚手架 |
| 7 | **权限/安全** | ✅ SecurityGuard + 黑名单 + 权限控制 + 速率限制 + 审计 | ✅ **达标** | 安全体系是 AgentForge 的强项，超过多数框架 |

**交集达标率：5/7 完全达标，2/7 部分达标（LLM 覆盖、记忆系统）**

---

## 二、补集对照 — 各家独门增强逐项检查

### 2.1 对照 AgentScope 的增强

| 增强特性 | AgentForge 现状 | 差距等级 |
|---------|----------------|---------|
| **分布式部署（K8s/Serverless）** | ❌ 无 | 🔴 缺失 |
| **模型微调（Prompt Tuning + Agentic RL）** | ❌ 无 | 🔴 缺失 |
| **实时语音模型（Realtime TTS/STT）** | ❌ 无 | 🔴 缺失 |
| **多模态工具（文生图/图生文/文生音）** | ❌ 无 | 🔴 缺失 |
| **评估基准（ACEBench + Ray 评估）** | ⚠️ 有 ResultValidator 但无标准化 Benchmark | 🟡 部分 |
| **会话持久化（Redis/Tablestore）** | ⚠️ 只有 SQLite | 🟡 部分 |
| **OTel 全链路追踪** | ❌ 自研 MetricsCollector，非 OTel 标准 | 🟡 部分 |
| **Formatter 系统（7种格式化器）** | ❌ 无，直接依赖 AI SDK | 🔴 缺失 |

### 2.2 对照 Deep Agents 的增强

| 增强特性 | AgentForge 现状 | 差距等级 |
|---------|----------------|---------|
| **中间件栈（12层可插拔）** | ⚠️ 有 Plugin 系统（拦截器+观察器），但不是中间件模式 | 🟡 不同方案 |
| **LangGraph 原生** | ❌ 自研 RxJS 引擎，非 LangGraph | 🔴 不适用 |
| **Harness Profile（提供商级配置覆盖）** | ❌ 无 | 🔴 缺失 |
| **异步远程子 Agent（Agent Protocol）** | ⚠️ A2A 有类似能力，但非 Agent Protocol 标准 | 🟡 部分 |
| **GitHub Actions 集成** | ❌ 无 action.yml | 🔴 缺失 |
| **多沙箱后端（5种）** | ⚠️ 只有 Docker 沙箱 | 🟡 部分 |
| **Anthropic Prompt Caching** | ❌ 无 | 🔴 缺失 |
| **对话离线存储（Markdown 文件）** | ❌ 无 | 🔴 缺失 |

### 2.3 对照 Mastra 的增强

| 增强特性 | AgentForge 现状 | 差距等级 |
|---------|----------------|---------|
| **80+ LLM 提供商** | ⚠️ ~8 家，OpenAI/Anthropic 完整 + 兼容层 | 🔴 差距大 |
| **图工作流引擎（.branch/.parallel/.foreach）** | ⚠️ 有 Sequential/Parallel Pipeline，无分支/循环 | 🟡 部分 |
| **24 个存储后端** | ⚠️ 只有 SQLite | 🔴 差距大 |
| **Graph RAG + 重排序** | ❌ 无 RAG | 🔴 缺失 |
| **14 个语音提供商** | ❌ 无 | 🔴 缺失 |
| **14 个可观测性平台** | ⚠️ 自研 MetricsCollector | 🟡 部分 |
| **9 个认证提供商** | ❌ 无认证系统 | 🔴 缺失 |
| **浏览器自动化** | ❌ 无 | 🔴 缺失 |
| **HTTP 框架适配器（Hono/Express/Fastify/Koa）** | ❌ 无 HTTP 服务层 | 🔴 缺失 |
| **客户端 SDK（JS/React）** | ❌ 无 | 🔴 缺失 |
| **项目脚手架** | ✅ `create-agentforge` | ✅ 达标 |

### 2.4 对照 OpenHarness 的增强

| 增强特性 | AgentForge 现状 | 差距等级 |
|---------|----------------|---------|
| **10+ 消息通道（飞书/Slack/Discord/Telegram 等）** | ❌ 无任何通道集成 | 🔴 缺失 |
| **ohmo 个人 Agent（自主 fork/写码/开 PR）** | ❌ 无 | 🔴 缺失 |
| **React + Ink TUI** | ❌ 只有纯 CLI | 🔴 缺失 |
| **43+ 内置工具** | ⚠️ 少量内置工具 | 🟡 部分 |
| **54 个 CLI 命令** | ⚠️ CLI 较简单 | 🟡 部分 |
| **claude-code 插件兼容** | ❌ 不兼容 | 🔴 缺失 |
| **Swarm 分布式协调（工作树/邮箱/锁）** | ❌ 无 | 🔴 缺失 |
| **Dry-Run 预览模式** | ❌ 无 | 🔴 缺失 |
| **Vim 模式 / 主题系统** | ❌ 无 | 🔴 缺失 |
| **Cron 定时任务** | ❌ 无 | 🔴 缺失 |

---

## 三、差距全景矩阵

```
特性                    AgentForge    差距等级    优先级
────────────────────    ──────────    ────────    ──────
交集必备：
  Agent Loop             ✅ 完整       —          —
  LLM 统一接口           ⚠️ Stub      🟡 中      P1
  工具系统+MCP           ✅ 完整       —          —
  记忆/上下文            ⚠️ 仅压缩     🟡 中      P1
  子 Agent               ✅ 完整       —          —
  CLI                    ✅ 完整       —          —
  权限/安全              ✅ 完整       —          —

补集增强 — 数据层：
  RAG (文档+向量检索)     ❌ 缺失       🔴 高      P1
  多存储后端              ⚠️ 仅 SQLite  🔴 高      P2
  Graph RAG              ❌ 缺失       🔴 高      P3

补集增强 — 模型层：
  Embedding 模型          ❌ 缺失       🔴 高      P1
  TTS/STT 语音           ❌ 缺失       🔴 中      P3
  实时语音               ❌ 缺失       🔴 中      P3

补集增强 — 集成层：
  HTTP 服务层             ❌ 缺失       🔴 高      P1
  消息通道               ❌ 缺失       🔴 中      P2
  认证系统               ❌ 缺失       🔴 中      P2
  浏览器自动化            ❌ 缺失       🔴 低      P3
  客户端 SDK             ❌ 缺失       🔴 中      P2

补集增强 — 可观测性：
  OpenTelemetry          ❌ 自研       🟡 中      P2
  可视化平台集成          ❌ 缺失       🟡 中      P2

补集增强 — 生态：
  GitHub Actions         ❌ 缺失       🟡 中      P2
  claude-code 兼容       ❌ 缺失       🔴 低      P3
  TUI 界面               ❌ 缺失       🟡 低      P3
  评估基准               ⚠️ 基础       🟡 中      P2
```

---

## 四、差距根因分析

AgentForge 的差距并非架构缺陷，而是**定位差异**导致的：

| 维度 | AgentForge 的选择 | 行业标准 | 根因 |
|------|-----------------|---------|------|
| **核心抽象** | RxJS 事件流 | LangGraph / 消息驱动 | 差异化选择，非缺陷 |
| **LLM 接入** | AI SDK v6 适配 | 自研 Provider 注册表 | 依赖 Vercel AI SDK，覆盖面取决于 SDK |
| **存储** | SQLite only | 向量库 + 关系库 + 缓存 | v0.1.2 早期，优先级在核心循环 |
| **RAG** | 无 | 文档处理 + 向量检索 + 重排序 | 定位为 Agent 框架而非 RAG 框架 |
| **部署** | npm 包 | HTTP 服务 + Serverless + 云 | 面向库使用者而非服务部署者 |
| **通道** | 无 | 飞书/Slack/Discord 等 | 面向开发者而非终端用户 |

**核心结论：AgentForge 是一个"Agent 循环引擎"，而非"Agent 应用平台"。**

它在 Agent Loop、事件流、安全体系上做到了极致（甚至超过其他框架），但在"把 Agent 交付给最终用户"这一层（HTTP 服务、消息通道、RAG、存储、认证）有大量空白。

---

## 五、补齐路线图建议

### P0 — 立即补（无替代方案）

| 项目 | 工作量 | 说明 |
|------|--------|------|
| **Google/Ollama 适配器完成** | 小 | 删除 Stub 标记，补充实际 API 调用 |
| **记忆持久化** | 中 | 增加 SQLite/Redis 向量存储，支持跨会话记忆 |

### P1 — 短期补（3-6 周）

| 项目 | 工作量 | 说明 |
|------|--------|------|
| **RAG 基础** | 大 | 文档读取 + 分块 + Embedding + 向量检索 |
| **Embedding 模型接入** | 中 | 通过 AI SDK 接入 OpenAI/通义 Embedding |
| **HTTP 服务层** | 中 | 内置 Hono/Express 适配器，暴露 REST API |
| **OpenTelemetry 追踪** | 中 | 替换自研 MetricsCollector 为 OTel 标准 |

### P2 — 中期补（2-3 月）

| 项目 | 工作量 | 说明 |
|------|--------|------|
| **多存储后端** | 大 | PostgreSQL / Redis / Qdrant 适配器 |
| **消息通道** | 大 | 至少 Slack + Discord + 飞书 |
| **认证框架** | 中 | JWT / OAuth 基础 + 至少 2 个提供商 |
| **GitHub Actions** | 小 | 编写 action.yml |
| **评估基准** | 中 | 标准化 Benchmark + 评分器 |

### P3 — 长期补（按需）

| 项目 | 工作量 | 说明 |
|------|--------|------|
| 语音（TTS/STT） | 大 | 按用户需求决定 |
| 浏览器自动化 | 大 | 按用户需求决定 |
| TUI 界面 | 中 | 提升开发者体验 |
| 客户端 SDK | 中 | 面向前端集成 |

---

## 六、AgentForge 的独占优势（反向分析）

在补齐差距的同时，AgentForge 有 **4 项独占优势**是其他框架不具备的：

| 独占优势 | 说明 | 其他框架有无 |
|---------|------|------------|
| **RxJS 事件流** | 所有操作为 Observable 变换，天然可组合、可取消 | ❌ 无 |
| **三层 API（L1/L2/L3）** | 零代码 → 配置式 → 编程式，覆盖不同用户群体 | ❌ 无（其他最多两层） |
| **哈希链审计** | 审计日志用哈希链保证完整性，防篡改 | ❌ 无 |
| **异常熔断** | CircuitBreaker + ErrorClassifier + AutoRepairer 三件套 | ❌ 无 |
| **结果校验** | ResultValidator + CompletionScorer + GoalAlignmentChecker | ❌ 无 |
| **配额管控** | Token/成本配额限制 | ❌ 无（OpenHarness 有 CostTracker 但无配额） |

**这些是 AgentForge 的护城河，不应在补齐过程中丢失。**

---

## 七、一句话总结

> AgentForge 的**骨架**（Agent Loop + 安全 + 可观测性）是行业顶级的，缺的是**血肉**（RAG + 存储 + HTTP 服务 + 通道 + 认证）。
>
> 补齐方向：**保持骨架优势，渐进填充血肉。** P1 先补 RAG + HTTP 服务 + 记忆持久化，让框架从"Agent 引擎"升级为"Agent 平台"。

---

*报告生成时间：2026-04-28*
