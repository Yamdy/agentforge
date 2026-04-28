# Mastra 项目深度分析报告

## 1. 项目定位与核心理念

**Mastra** 是一个基于 TypeScript 的 AI Agent 框架，由 Y Combinator W25 孵化，旨在帮助开发者从原型快速构建到生产级别的 AI 应用。

**核心理念：**
- **TypeScript 优先**：完全用 TypeScript 构建，面向全栈 JS/TS 开发者
- **All-in-One**：提供从模型路由、Agent、工作流、RAG、记忆到部署的完整工具链
- **生产就绪**：内置评估(evals)、可观测性(observability)、认证(auth)等生产级能力
- **框架无关集成**：可嵌入 React/Next.js/Node.js 应用，也可独立部署

**仓库信息：**
- GitHub: https://github.com/mastra-ai/mastra
- 许可证: Apache-2.0 (核心) + Mastra Enterprise License (ee/ 目录)
- 版本: @mastra/core v1.29.0-alpha.2
- 包管理器: pnpm 10.29.3
- Node.js 要求: >= 22.13.0

---

## 2. 架构设计

### 2.1 Monorepo 结构

Mastra 采用 pnpm workspace + Turborepo 的 monorepo 架构，目录结构如下：

```
mastra/
├── packages/           # 核心包
│   ├── core/           # 核心框架 (@mastra/core)
│   ├── rag/            # RAG 模块 (@mastra/rag)
│   ├── memory/         # 记忆模块 (@mastra/memory)
│   ├── mcp/            # MCP 服务器/客户端 (@mastra/mcp)
│   ├── evals/          # 评估模块 (@mastra/evals)
│   ├── server/         # HTTP 服务器
│   ├── cli/            # CLI 工具
│   ├── create-mastra/  # 项目脚手架
│   ├── deployer/       # 部署器
│   ├── editor/         # 编辑器集成
│   ├── playground/     # 开发 Playground
│   ├── playground-ui/  # Playground UI
│   ├── agent-builder/  # Agent 构建器
│   ├── schema-compat/  # Schema 兼容层
│   ├── fastembed/      # 快速嵌入
│   ├── loggers/        # 日志器
│   ├── codemod/        # 代码迁移工具
│   └── _*/             # 内部工具包
├── stores/             # 向量/存储后端 (24个)
├── voice/              # 语音服务 (14个)
├── deployers/          # 部署目标 (4个)
├── server-adapters/    # 服务器适配器 (4个)
├── auth/               # 认证提供商 (9个)
├── observability/      # 可观测性集成 (14个)
├── browser/            # 浏览器自动化 (3个)
├── client-sdks/        # 客户端 SDK (3个)
├── integrations/       # 第三方集成
├── workflows/          # 工作流引擎
├── pubsub/             # 消息队列
├── examples/           # 示例项目
└── docs/               # 文档站点 (Docusaurus)
```

### 2.2 核心模块 (packages/core)

`@mastra/core` 是框架的核心，包含 50+ 子模块：

| 模块 | 功能 |
|------|------|
| `agent/` | Agent 定义、执行、消息处理 |
| `llm/` | LLM 模型路由、Provider 注册、AI SDK v4/v5/v6 兼容 |
| `tools/` | 工具定义、Tool Builder、Provider Tools |
| `workflows/` | 图工作流引擎、步骤、分支、并行 |
| `memory/` | 记忆管理（对话历史、工作记忆、语义记忆） |
| `storage/` | 存储抽象层 |
| `vector/` | 向量数据库抽象 |
| `mcp/` | MCP 协议支持 |
| `rag/` | RAG 管道 |
| `evals/` | 评估框架 |
| `observability/` | 追踪与可观测性 |
| `auth/` | 认证框架 |
| `voice/` | 语音接口 |
| `browser/` | 浏览器自动化 |
| `server/` | HTTP API 服务 |
| `deployer/` | 部署抽象 |
| `bundler/` | 代码打包 |
| `cache/` | 缓存层 |
| `channels/` | 消息通道 |
| `datasets/` | 数据集管理 |
| `di/` | 依赖注入 |
| `editor/` | 编辑器集成 |
| `events/` | 事件系统 |
| `features/` | 特性标志 |
| `hooks/` | 生命周期钩子 |
| `integration/` | 集成框架 |
| `loop/` | Agent 循环与网络循环 |
| `processors/` | 消息处理器 |
| `relevance/` | 相关性评估 |
| `request-context/` | 请求上下文 |
| `schema/` | Schema 定义 |
| `stream/` | 流式处理 |
| `tts/` | 文本转语音 |
| `workspace/` | 工作区管理 |
| `a2a/` | Agent-to-Agent 协议 |
| `background-tasks/` | 后台任务 |
| `harness/` | 测试工具 |

### 2.3 数据流

```
用户输入 → Agent (推理循环)
    ↓
LLM Router → Provider Registry → 具体 LLM Provider
    ↓
Tool Calling → Tool Builder → 执行工具
    ↓
Memory System → 对话历史 + 工作记忆 + 语义记忆
    ↓
RAG Pipeline → 向量检索 → 上下文注入
    ↓
Output → 流式/非流式响应 → 客户端
```

---

## 3. 功能特性列表

### 3.1 Agent 系统
- ✅ 自主 Agent（推理-工具循环直到完成）
- ✅ Agent 配置：模型、指令、工具、温度、最大步数等
- ✅ 流式与非流式生成
- ✅ 结构化输出（JSON Schema / Zod）
- ✅ Agent 处理器（Processor）- 输入/输出预处理
- ✅ Agent 网络（Network）- 多 Agent 协作循环
- ✅ Agent-to-Agent (A2A) 协议支持
- ✅ Tool Loop Agent - 工具循环代理
- ✅ Agent Writer - 流式写入
- ✅ 消息列表管理（MessageList）
- ✅ Trip Wire - 安全护栏/触发器
- ✅ 流式空闲检测（Stream Until Idle）
- ✅ 保存队列（Save Queue）

### 3.2 工作流系统
- ✅ 图-based 工作流引擎
- ✅ 链式执行 `.then()`
- ✅ 条件分支 `.branch()`
- ✅ 并行执行 `.parallel()`
- ✅ 循环 `.foreach()`
- ✅ 挂起与恢复 (Suspend & Resume)
- ✅ Human-in-the-Loop（人工审批/输入）
- ✅ 事件驱动工作流 (Evented Workflows)
- ✅ 工作流步骤（Step）定义
- ✅ 工作流 Schema 验证
- ✅ 流式工作流执行
- ✅ Inngest 集成

### 3.3 记忆系统
- ✅ 对话历史管理（Conversation History）
- ✅ 工作记忆（Working Memory）- 类人短期记忆
- ✅ 语义记忆（Semantic Recall）- 基于向量的长期记忆
- ✅ 线程管理（Thread Management）
- ✅ 消息存储与检索
- ✅ 记忆处理器（Processors）- 自定义记忆处理
- ✅ 系统提醒（System Reminders）
- ✅ 克隆线程
- ✅ 图片探测（Probe Image Size）

### 3.4 RAG 能力
- ✅ 文档处理与分块
- ✅ 向量嵌入与存储
- ✅ 语义搜索
- ✅ Graph RAG（知识图谱增强检索）
- ✅ 重排序（Reranking）
- ✅ RAG 工具集成
- ✅ 多种分块策略
- ✅ 文档加载器

### 3.5 模型路由与 LLM 集成
- ✅ 统一模型接口
- ✅ 40+ LLM Provider 支持（见下文详细列表）
- ✅ Provider 注册表（自动生成）
- ✅ 自定义 Provider 支持
- ✅ 嵌入路由（Embedding Router）
- ✅ AI SDK v4/v5/v6 多版本兼容
- ✅ 模型解析与配置
- ✅ Provider Options 透传
- ✅ Gateway 解析器

### 3.6 工具/函数调用
- ✅ 工具定义（Zod Schema）
- ✅ Tool Builder - 动态工具构建
- ✅ Provider Tools - 内置工具
- ✅ 工具流（Tool Stream）
- ✅ 工具验证
- ✅ Vercel AI SDK 工具兼容
- ✅ 工具持久化
- ✅ 工具排序

### 3.7 MCP (Model Context Protocol)
- ✅ MCP 服务器创建
- ✅ MCP 客户端
- ✅ MCP 版本管理
- ✅ MCP 注册表（Registry Registry）
- ✅ MCP 文档服务器

### 3.8 语音 (Voice)
- ✅ TTS（文本转语音）
- ✅ STT（语音转文本）
- ✅ 实时语音 API
- ✅ 14 个语音提供商：
  - Azure、Cloudflare、Deepgram、ElevenLabs、Gladia
  - Google、Google Gemini Live API、Modelslab、Murf
  - OpenAI、OpenAI Realtime API、PlayAI、Sarvam、Speechify

### 3.9 浏览器自动化
- ✅ Agent Browser - Agent 驱动的浏览器操作
- ✅ Browser Viewer - 浏览器查看器
- ✅ Stagehand 集成

### 3.10 评估 (Evals)
- ✅ 内置评估框架
- ✅ 评分器（Scorer）定义
- ✅ 评分采样配置
- ✅ 评分追踪
- ✅ Agent 评估集成

### 3.11 可观测性 (Observability)
- ✅ OpenTelemetry (OTel) 集成
- ✅ OTel Bridge 与 Exporter
- ✅ 14 个可观测性平台集成：
  - Arize、Arthur、Braintrust、Datadog
  - Laminar、Langfuse、LangSmith
  - Mastra 自有追踪、PostHog、Sentry
  - ClickHouse 设计

### 3.12 认证 (Auth)
- ✅ 认证框架
- ✅ 9 个认证提供商：
  - Auth0、Better Auth、Clerk、Cloud
  - Firebase、Okta、Studio、Supabase、WorkOS
- ✅ 企业版认证 (ee/)

### 3.13 部署
- ✅ 4 个部署目标：
  - Cloudflare Workers、Netlify、Vercel、Mastra Cloud
- ✅ 部署抽象层
- ✅ 代码打包 (Bundler)

### 3.14 服务器适配器
- ✅ 4 个 HTTP 框架适配器：
  - Hono、Express、Fastify、Koa

### 3.15 客户端 SDK
- ✅ JavaScript 客户端 (`client-js`)
- ✅ React SDK (`react`)
- ✅ AI SDK 适配器 (`ai-sdk`)

### 3.16 其他能力
- ✅ 依赖注入 (DI)
- ✅ 事件系统
- ✅ 缓存层
- ✅ 消息通道 (Channels)
- ✅ 数据集管理
- ✅ 后台任务
- ✅ Schema 兼容层（Zod v3/v4）
- ✅ 特性标志
- ✅ 请求上下文
- ✅ Pub/Sub 集成（Google Cloud PubSub）

---

## 4. 支持的 LLM 提供商

Mastra 通过 provider-registry.json 支持 **80+ 个 LLM 提供商**，涵盖数千个模型。主要提供商分类：

### 4.1 一线大厂
| 提供商 | 包名 | 备注 |
|--------|------|------|
| **OpenAI** | `@ai-sdk/openai` | GPT-5 系列、o1/o3/o4 系列、GPT-Image |
| **Anthropic** | `@ai-sdk/anthropic` | Claude 3/4/4.5/4.6/4.7 系列 |
| **Google** | `@ai-sdk/google` | Gemini 2.0/2.5/3.0/3.1、Gemma |
| **xAI** | `@ai-sdk/xai` | Grok 2/3/4 系列 |
| **DeepSeek** | - | DeepSeek-V3/V4、R1 |
| **Mistral** | `@ai-sdk/mistral` | Mistral/Magistral/Codestral/Devstral |

### 4.2 中国厂商
| 提供商 | 备注 |
|--------|------|
| **Alibaba (通义千问)** | Qwen3/3.5/3.6 系列，国内/国际/Coding Plan |
| **Zhipu AI (智谱)** | GLM-4.5/4.6/4.7/5/5.1 |
| **Xiaomi (小米)** | MiMo-V2 系列（新加坡/中国/欧洲/AMS） |
| **Moonshot AI (月之暗面)** | Kimi-K2 系列 |
| **Baidu (百度)** | ERNIE 4.5/5.0 |
| **Tencent (腾讯)** | Hunyuan、TokenHub |
| **StepFun (阶跃星辰)** | Step 3/3.5 |
| **ByteDance** | Seed 1.6/1.8/2.0 (通过 Doubao) |
| **MiniMax** | M2/M2.1/M2.5/M2.7 |
| **SiliconFlow** | 国内/国际中转 |
| **Baichuan** | M2 |
| **InclusionAI** | Ling/Ring |

### 4.3 聚合/路由平台
| 提供商 | 备注 |
|--------|------|
| **OpenRouter** | 200+ 模型路由 |
| **Vercel AI Gateway** | 250+ 模型 |
| **Helicone** | 模型路由+监控 |
| **Kilo Gateway** | 模型聚合 |
| **NanoGPT** | 模型聚合 |
| **Poe** | 模型聚合 |
| **LLM Gateway** | 模型路由 |
| **ZenMux** | 模型路由 |
| **302.AI** | 模型聚合 |
| **Requesty** | 模型路由 |
| **FastRouter** | 模型路由 |

### 4.4 云服务商
| 提供商 | 备注 |
|--------|------|
| **Groq** | 高速推理 |
| **Cerebras** | 芯片推理 |
| **Nvidia** | NIM 推理 |
| **Fireworks AI** | 推理服务 |
| **Together AI** | 推理服务 |
| **Deep Infra** | 推理服务 |
| **Nebius** | Token Factory |
| **Scaleway** | 欧洲云推理 |
| **DigitalOcean** | AI 推理 |
| **OVHcloud** | AI Endpoints |
| **Vultr** | 推理服务 |
| **Baseten** | 推理服务 |
| **Cloudflare Workers AI** | 边缘推理 |
| **Hugging Face** | 推理路由 |
| **GitHub Models** | 模型市场 |
| **Ollama Cloud** | 云端 Ollama |
| **LMStudio** | 本地推理 |
| **Novita AI** | 推理服务 |
| **Chutes** | TEE 推理 |
| **Abacus** | 推理路由 |
| **HPC-AI** | 高性能推理 |

### 4.5 特殊用途
| 提供商 | 备注 |
|--------|------|
| **Perplexity** | 搜索增强推理 |
| **Perplexity Agent** | Agent API |
| **Moonshot AI** | Kimi For Coding |
| **Upstage** | Solar 模型 |
| **Clarifai** | 多模态推理 |
| **Inference** | 推理平台 |
| **Llama** | Meta 官方 API |
| **Morph** | 代码编辑 |
| **Inception** | Mercury 快速推理 |

---

## 5. 存储后端

Mastra 支持 **24 个存储/向量后端**：

### 向量数据库
| 后端 | 目录 |
|------|------|
| Pinecone | `stores/pinecone` |
| Qdrant | `stores/qdrant` |
| Chroma | `stores/chroma` |
| LanceDB | `stores/lance` |
| Astra (DataStax) | `stores/astra` |
| Elasticsearch | `stores/elasticsearch` |
| OpenSearch | `stores/opensearch` |
| Cloudflare Vectorize | `stores/vectorize` |
| Turbopuffer | `stores/turbopuffer` |
| S3 Vectors | `stores/s3vectors` |

### 关系型/文档数据库
| 后端 | 目录 |
|------|------|
| PostgreSQL (pg) | `stores/pg` |
| LibSQL/Turso | `stores/libsql` |
| MongoDB | `stores/mongodb` |
| Cloudflare D1 | `stores/cloudflare-d1` |
| DuckDB | `stores/duckdb` |
| MSSQL | `stores/mssql` |
| ClickHouse | `stores/clickhouse` |
| Couchbase | `stores/couchbase` |
| DynamoDB | `stores/dynamodb` |
| Convex | `stores/convex` |

### 缓存/键值
| 后端 | 目录 |
|------|------|
| Redis | `stores/redis` |
| Upstash | `stores/upstash` |
| Cloudflare KV | `stores/cloudflare` |

---

## 6. 技术栈与依赖

### 核心依赖
| 依赖 | 用途 |
|------|------|
| `@ai-sdk/*` (v4/v5/v6) | Vercel AI SDK 多版本兼容 |
| `@modelcontextprotocol/sdk` | MCP 协议实现 |
| `@a2a-js/sdk` | Agent-to-Agent 协议 |
| `hono` | 轻量 HTTP 框架 |
| `hono-openapi` | OpenAPI 集成 |
| `zod` (v3/v4) | Schema 验证 |
| `ajv` | JSON Schema 验证 |
| `js-tiktoken` | Token 计数 |
| `ws` | WebSocket 支持 |
| `gray-matter` | Front-matter 解析 |
| `execa` | 进程管理 |
| `lru-cache` / `@isaacs/ttlcache` | 缓存 |
| `p-map` / `p-retry` | 并发控制与重试 |
| `xxhash-wasm` | 哈希计算 |
| `picomatch` | 文件匹配 |
| `dotenv` | 环境变量 |
| `radash` | 工具函数 |

### 开发工具
| 工具 | 用途 |
|------|------|
| Turborepo | Monorepo 构建编排 |
| pnpm 10.29.3 | 包管理 |
| TypeScript | 类型系统 |
| Vitest | 测试框架 |
| tsup | 库打包 |
| ESLint | 代码检查 |
| Prettier | 代码格式化 |
| Husky | Git Hooks |
| Changesets | 版本管理 |
| Docusaurus | 文档站点 |

---

## 7. 插件/扩展机制

Mastra 提供多层扩展机制：

### 7.1 Provider 注册
```typescript
// 自定义 LLM Provider
const provider = createProvider({
  name: 'my-provider',
  url: 'https://api.example.com/v1',
  models: ['model-1', 'model-2'],
});
```

### 7.2 工具扩展
```typescript
// 自定义工具
const myTool = createTool({
  id: 'my-tool',
  description: 'My custom tool',
  inputSchema: z.object({ ... }),
  execute: async (context) => { ... },
});
```

### 7.3 存储插件
```typescript
// 自定义存储后端
class MyStore implements MastraStorage { ... }
```

### 7.4 可观测性插件
- OpenTelemetry 标准接口
- 可接入任意 OTel 兼容后端

### 7.5 集成框架
- `Integration` 基类用于构建第三方集成
- Tavily 集成作为参考实现

### 7.6 MCP 扩展
- MCP 服务器可暴露 Agent、工具和资源
- 支持任意 MCP 兼容客户端

### 7.7 认证插件
- 9 个预置认证提供商
- 可扩展自定义认证

---

## 8. 部署方式

### 自部署
- **Standalone Server**：通过 `@mastra/server` 独立运行
- **框架集成**：嵌入 Next.js / Express / Fastify / Koa / Hono
- **边缘部署**：Cloudflare Workers / Netlify Edge Functions
- **Serverless**：Vercel Functions
- **Docker**：支持容器化部署

### 云服务
- **Mastra Cloud**：官方托管服务（`deployers/cloud`）
- **Vercel**：一键部署
- **Netlify**：一键部署
- **Cloudflare**：Workers 部署

### CLI 工具
```bash
npm create mastra@latest    # 创建项目
mastra deploy               # 部署到云
```

---

## 9. 项目成熟度评估

### 优势
| 维度 | 评分 | 说明 |
|------|------|------|
| **功能完整性** | ⭐⭐⭐⭐⭐ | Agent、工作流、RAG、记忆、语音、浏览器一应俱全 |
| **模型支持** | ⭐⭐⭐⭐⭐ | 80+ Provider，数千模型，覆盖面极广 |
| **存储支持** | ⭐⭐⭐⭐⭐ | 24 个存储后端，从向量库到关系型数据库 |
| **可观测性** | ⭐⭐⭐⭐⭐ | OTel 标准 + 14 个平台集成 |
| **文档质量** | ⭐⭐⭐⭐ | Docusaurus 文档站，有教程和示例 |
| **TypeScript 支持** | ⭐⭐⭐⭐⭐ | 完整类型定义，Zod Schema 验证 |
| **社区活跃度** | ⭐⭐⭐⭐ | GitHub Stars、Discord 社区、Y Combinator 背书 |
| **测试覆盖** | ⭐⭐⭐⭐ | Vitest 测试、E2E 测试、集成测试 |
| **生产就绪度** | ⭐⭐⭐⭐ | 内置认证、缓存、错误处理、重试机制 |
| **代码质量** | ⭐⭐⭐⭐ | ESLint + Prettier + TypeScript 严格模式 |

### 需要关注的点
1. **版本状态**：核心包仍为 `1.29.0-alpha.2`，API 可能变化
2. **复杂度**：monorepo 包含 100+ 子包，学习曲线较陡
3. **AI SDK 依赖**：深度依赖 Vercel AI SDK，需关注版本同步
4. **企业功能**：`ee/` 目录下的功能需要企业许可证
5. **Node.js 要求**：需要 Node.js >= 22.13.0，较新

### 总体评价

Mastra 是目前 TypeScript 生态中**功能最全面的 AI Agent 框架之一**。它不仅覆盖了 Agent 开发的方方面面（模型路由、工具调用、记忆管理、RAG、工作流），还提供了完整的生产级基础设施（认证、可观测性、评估、部署）。其模型支持范围极广（80+ Provider），存储后端丰富（24 个），且通过 MCP 和 A2A 协议支持开放互操作。

对于 TypeScript/JavaScript 全栈开发者来说，Mastra 是构建 AI 应用的强有力选择，特别适合需要：
- 多模型路由与切换
- 复杂工作流编排
- 生产级可观测性
- 多种存储后端
- 快速从原型到生产

的场景。

---

*报告生成时间: 2026-04-28*
*数据来源: GitHub 仓库代码分析*
