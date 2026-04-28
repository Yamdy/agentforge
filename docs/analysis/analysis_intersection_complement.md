# AI Agent 框架：交集（必须有）与补集（独门增强）

> 分析时间：2026-04-28
> 基准框架：AgentScope / Deep Agents / Mastra / OpenHarness（排除 AgentForge）

---

## 一、交集 — 四个框架都有的部分 = Agent 框架的最小可行定义

### 1. Agent Loop（推理循环）

四家都有，且结构一致：

```
输入 → LLM 推理 → 有工具调用？
  ├── 是 → 执行工具 → 结果回传 → 继续推理（循环）
  └── 否 → 输出结果
```

**交集实现：**
- 流式输出（逐 token）
- 工具调用循环（多轮直到完成）
- 最大步数限制
- 错误不崩溃（单工具失败隔离）

### 2. LLM 统一接口

四家都做了抽象层，一套 API 调用多家模型。

**交集实现：**
- 至少支持 OpenAI + Anthropic + Google + Ollama
- 流式 + 非流式双模式
- 模型名自动路由（`gpt-*` → OpenAI，`claude-*` → Anthropic）

### 3. 工具系统

四家都有工具注册、定义、执行机制。

**交集实现：**
- Schema 定义（Zod 或 Pydantic）
- 工具注册表（运行时查找）
- 工具执行（输入验证 → 执行 → 结果返回）
- MCP 集成（stdio + HTTP）

### 4. 记忆 / 上下文管理

四家都有某种形式的记忆机制。

**交集实现：**
- 对话历史（当前会话消息列表）
- 上下文压缩（token 超限时自动摘要）
- 持久化某种形式的跨会话知识（MEMORY.md 或向量存储）

### 5. 子 Agent / 多 Agent

四家都支持父 Agent 创建子 Agent。

**交集实现：**
- 子 Agent 生成（声明式定义 name + prompt + tools）
- 任务委派（父 → 子）
- 子 Agent 独立运行循环

### 6. CLI 可执行

四家都能通过命令行直接运行。

**交集实现：**
- `pip install` 或 `npm install` 后可执行
- 支持非交互模式（管道/脚本集成）

### 7. 权限 / 安全控制

四家都有某种安全机制。

**交集实现：**
- 工具执行前有某种形式的权限检查
- 危险操作有拦截或确认机制

---

### 交集总结：Agent 框架的最小定义

```
Agent Framework = Agent Loop
                + LLM Router
                + Tool System (with MCP)
                + Memory (history + compression)
                + Sub-Agent
                + CLI
                + Permissions
```

**7 件事，少一件就不算完整的 Agent 框架。**

---

## 二、补集 — 各家独门特长 = 对框架的增强方向

### AgentScope 的独占增强

| 增强 | 说明 | 其他三家有无 |
|------|------|------------|
| **分布式部署** | K8s 集群 + Serverless | ❌ 无 |
| **模型微调** | Prompt Tuning + Agentic RL (Trinity-RFT) | ❌ 无 |
| **实时语音模型** | DashScope/OpenAI/Gemini Realtime | ❌ 无 |
| **多模态工具** | 文生图/图生文/文生音（DashScope + OpenAI） | ❌ 无 |
| **评估基准** | ACEBench + 分布式 Ray 评估 | ❌ 无 |
| **会话持久化** | Redis / Tablestore / JSON 三种实现 | ❌ 无（其他都是文件级） |
| **OTel 全链路** | trace_llm / trace_toolkit / trace_embedding 细粒度 | ❌ 无（Mastra 有 OTel 但粒度粗） |
| **Formatter 系统** | 7 种格式化器，每种 Chat + MultiAgent 变体 | ❌ 无 |

**定位**：企业级生产部署——分布式、微调、多模态、全链路追踪。

### Deep Agents 的独占增强

| 增强 | 说明 | 其他三家有无 |
|------|------|------------|
| **中间件栈** | 12 层中间件，可插拔、可排序、可覆盖 | ❌ 无 |
| **LangGraph 原生** | `create_deep_agent()` 返回编译好的 LangGraph 图 | ❌ 无 |
| **Harness Profile** | 提供商级和模型级的配置覆盖 | ❌ 无 |
| **异步远程子 Agent** | Agent Protocol 连接远程 Agent，后台运行 | ❌ 无 |
| **GitHub Actions 集成** | action.yml 直接在 CI 中运行 Agent | ❌ 无 |
| **多沙箱后端** | LangSmith / Daytona / Modal / Runloop / AgentCore 5 种 | ❌ 无 |
| **Anthropic Prompt Caching** | 自动添加 cache_control 断点 | ❌ 无 |
| **对话离线存储** | 压缩的消息保存为 Markdown 文件 | ❌ 无 |

**定位**：中间件架构 + LangGraph 生态——最优雅的扩展模式。

### Mastra 的独占增强

| 增强 | 说明 | 其他三家有无 |
|------|------|------------|
| **80+ LLM 提供商** | provider-registry.json 自动注册数千模型 | ❌ 无 |
| **图工作流引擎** | .then() / .branch() / .parallel() / .foreach() / suspend/resume | ❌ 无 |
| **24 个存储后端** | 向量库 + 关系库 + 缓存，全覆盖 | ❌ 无 |
| **Graph RAG** | 知识图谱增强检索 + 重排序 | ❌ 无 |
| **14 个语音提供商** | TTS / STT / Realtime 全覆盖 | ❌ 无 |
| **14 个可观测性平台** | Arize / Datadog / Langfuse / Sentry 等 | ❌ 无 |
| **9 个认证提供商** | Auth0 / Clerk / Firebase / Supabase 等 | ❌ 无 |
| **浏览器自动化** | Agent Browser + Stagehand 集成 | ❌ 无 |
| **4 个 HTTP 框架适配器** | Hono / Express / Fastify / Koa | ❌ 无 |
| **3 个客户端 SDK** | JS / React / AI SDK 适配器 | ❌ 无 |

**定位**：功能最全的 TypeScript 全栈框架——覆盖面最广。

### OpenHarness 的独占增强

| 增强 | 说明 | 其他三家有无 |
|------|------|------------|
| **10+ 消息通道** | 飞书/Slack/Discord/Telegram/钉钉/WhatsApp/Matrix/QQ/Email | ❌ 无 |
| **ohmo 个人 Agent** | 开箱即用的个人 AI 助手 | ❌ 无 |
| **React + Ink TUI** | 终端 UI 框架 | ❌ 无 |
| **43+ 内置工具** | 文件/Shell/搜索/Web/Notebook/Agent/任务/MCP/定时 | ❌ 无 |
| **54 个 CLI 命令** | /help /commit /plan /resume 等 | ❌ 无 |
| **claude-code 插件兼容** | 直接复用 anthropics/skills 和 claude-code/plugins | ❌ 无 |
| **Swarm 分布式协调** | 工作树 + 邮箱 + 锁文件 + 权限同步 | ❌ 无 |
| **Dry-Run 预览** | 预览运行时设置和提示词组装，不执行 | ❌ 无 |
| **Vim 模式 / 主题系统** | 终端交互增强 | ❌ 无 |

**定位**：终端体验 + 消息平台集成 + 生态兼容。

---

## 三、矩阵总览

```
                    AgentScope   DeepAgents   Mastra   OpenHarness
                    ──────────   ──────────   ──────   ───────────
交集（必须有）：
  Agent Loop          ✅           ✅           ✅        ✅
  LLM 统一接口        ✅           ✅           ✅        ✅
  工具系统+MCP        ✅           ✅           ✅        ✅
  记忆/上下文          ✅           ✅           ✅        ✅
  子 Agent            ✅           ✅           ✅        ✅
  CLI                 ✅           ✅           ✅        ✅
  权限/安全            ✅           ✅           ✅        ✅

补集（独门）：
  分布式部署           ■
  模型微调(RL)         ■
  实时语音模型         ■
  多模态工具           ■
  评估基准             ■
  中间件栈                        ■
  LangGraph 原生                  ■
  多沙箱后端                      ■
  GitHub Actions                  ■
  80+ LLM                                    ■
  图工作流引擎                                ■
  24 存储后端                                 ■
  Graph RAG                                   ■
  14 语音提供商                               ■
  14 可观测性平台                             ■
  认证系统                                    ■
  浏览器自动化                                ■
  10+ 消息通道                                           ■
  ohmo 个人 Agent                                        ■
  React TUI                                              ■
  43+ 工具 / 54 命令                                     ■
  claude-code 插件兼容                                   ■
  Swarm 分布式协调                                       ■
  主题/键绑定/Vim                                         ■
```

---

*报告生成时间：2026-04-28*
