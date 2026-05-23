<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="agentforge-logo-v4.jpg">
    <img src="agentforge-logo-v4.jpg" alt="AgentForge" width="120" />
  </picture>
</p>

<h3 align="center">AgentForge</h3>

<p align="center">
  <strong>开箱即用的 TypeScript Agent 框架</strong><br/>
  流水线驱动 · 多智能体编排 · 兼容任意 LLM 提供商
</p>

<p align="center">
  <a href="https://agentforge-docs.vercel.app/">文档</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#为什么选择-agentforge">特性对比</a> ·
  <a href="docs/feature-tree.md">功能树</a> ·
  <a href="#生产就绪">生产就绪</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@primo-ai/core"><img src="https://img.shields.io/npm/v/@primo-ai/core?label=%40primo-ai%2Fcore&style=flat-square" alt="npm" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white&style=flat-square" alt="TypeScript" />
  <a href="https://github.com/Yamdy/agentforge/stargazers"><img src="https://img.shields.io/github/stars/Yamdy/agentforge?style=social" alt="stars" /></a>
</p>

<p align="center">
  <a href="./README.md">English</a> | 中文
</p>

---

## 💡 为什么选择 AgentForge？

每个流水线阶段同时是**扩展点**、**可观测性跨度**和**钩子拦截点**——一种机制，三种能力。

- ⚙️ [**流水线引擎**](docs/feature-tree.md#sf-1-agent-pipeline-engine) — 10 阶段处理器流水线，含 preLoop / loop / postLoop 区段，4 种控制流（中止 / 重试 / 挂起 / 错误）
- 🤖 [**多智能体编排**](docs/feature-tree.md#sf-4-multi-agent-orchestration) — 顺序、并行与路由执行器，以流式流水线声明复杂工作流
- 🧠 [**LLM 集成**](docs/feature-tree.md#sf-2-llm-integration) — 网关链支持 OpenAI、Anthropic、Google、DeepSeek 及任意 OpenAI 兼容端点。内置兼容规则与模型降级
- 🛠️ [**16 个内置工具**](docs/feature-tree.md#sf-3-tool-system) — 文件、网络、系统、工具、记忆——另有 MCP 协议支持外部工具与子智能体即工具
- 🔌 [**15+ 生产级插件**](docs/feature-tree.md#sf-7-plugin-system) — 记忆、压缩、权限、技能、MCP、驱逐、校验、费用上限、Token 预算、速率限制、PII 脱敏、内容审核
- 📋 [**任务队列**](docs/feature-tree.md#sf-10-task-management) — 基于优先级的并发控制，支持长时任务自动检查点恢复
- 💾 [**会话持久化**](docs/feature-tree.md#sf-6-session--persistence) — 挂起 / 恢复，支持 JSONL 与 SQLite 后端。11 种事件类型完整回放。专为 HITL 工作流设计
- 🌐 [**A2A 协议**](docs/feature-tree.md#sf-9-server--deployment) — 原生 Agent-to-Agent JSON-RPC，支持流式传输、Agent Card 与工件交换

## 🚀 快速开始

```bash
npm install @primo-ai/core
```

```typescript
import { Agent, registerProvider } from '@primo-ai/core';

registerProvider('deepseek', (modelId) =>
  createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY!,
  }).languageModel(modelId)
);

const { response } = await new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: '你是一个有帮助的助手。',
}).run('你好！');
```

<details>
<summary>使用 OpenAI / Anthropic / Google</summary>

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

registerProvider('openai',    (m) => createOpenAI({ apiKey: process.env.OPENAI_API_KEY! }).languageModel(m));
registerProvider('anthropic', (m) => createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }).languageModel(m));

const agent = new Agent({ model: 'anthropic/claude-sonnet-4-6-20250514', systemPrompt: '你是一个有帮助的助手。' });
```

</details>

## 📦 示例

### 🤝 多智能体编排

```typescript
import { createPipeline } from '@primo-ai/core';

const result = await createPipeline()
  .step({ name: 'research', agent: researcherAgent })
  .step({
    name: 'parallel-review',
    agents: [criticAgent, factCheckerAgent],
    options: { aggregator: (r) => r.map(x => x.response).join('\n---\n') },
  })
  .step({
    name: 'route',
    router: {
      classifier: (input) => input.includes('code') ? 'coder' : 'writer',
      routes: { coder: coderAgent, writer: writerAgent },
    },
  })
  .run('解释快速排序');
```

### 🔌 添加生产级插件

```typescript
import { memoryPlugin, compressionPlugin, permissionPlugin } from '@primo-ai/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: '你是一个有帮助的助手。',
  plugins: [
    memoryPlugin({ backend: 'sqlite' }),
    compressionPlugin({ maxTokens: 8000 }),
    permissionPlugin({ mode: 'interactive' }),
  ],
});
```

### 📋 任务队列

```typescript
import { TaskQueueImpl } from '@primo-ai/core';

const queue = new TaskQueueImpl({ maxConcurrency: 4, persistence: 'file' });
const handle = await queue.enqueue('analyst', { input: '分析此数据集...' }, {
  priority: 5, timeout: 600_000, autoCheckpoint: true,
});

handle.on('complete', (data) => console.log('完成:', data));
```

### ⚙️ 自定义处理器

```typescript
import { createFactInjectionProcessor } from '@primo-ai/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: '你是一个有帮助的助手。',
  plugins: [{
    name: 'inject-time',
    processors: [{
      stage: 'buildContext',
      processor: createFactInjectionProcessor({
        facts: { currentTime: () => new Date().toISOString() },
      }),
    }],
  }],
});
```

> [!TIP]
> 每个阶段都会发射事件——零配置订阅：`agent.eventSystem.subscribe('invokeLLM:after', handler)`

## ⚖️ 特性对比

| | AgentForge | Mastra | AgentScope | CrewAI |
|---|---|---|---|---|
| 语言 | TypeScript | TypeScript | Python | Python |
| 流水线模型 | Processor + Span + Hook | 仅 Middleware | 仅 Pipeline | 基于任务 |
| 多智能体 | 顺序 / 并行 / 路由 | 手动编排 | 基础 | Crew + Flow |
| 生产级防护 | costCap, tokenBudget, rateLimit, PII, moderation | 部分 | 非内置 | 非内置 |
| A2A 协议 | 原生 + 流式 | 手动 | 原生 | 非内置 |
| 任务队列 | 优先级 + 并发 + 检查点 | 基础 | 非内置 | 非内置 |
| 会话持久化 | JSONL + SQLite + 检查点 | 基础 | SQLite | 基础 |
| 插件系统 | 15+ 内置，一行注册 | 有限 | Toolkit + MCP | Tools + MCP |

## 🏗️ 架构

```
processInput → buildContext → [Agentic Loop:
  prepareStep → gateLLM → invokeLLM → processStepOutput → gateTool → executeTools → evaluateIteration
] → processOutput
```

每个阶段接收一个 `PipelineContext`，包含四个区域：

| 区域 | 用途 |
|------|------|
| `request` | 不可变输入（消息、sessionId） |
| `agent` | 配置、系统提示、工具声明、提示片段 |
| `iteration` | 单步状态（响应、工具调用、循环指令、跨度） |
| `session` | 跨步状态（历史记录、Token 用量、插件数据） |

```
packages/
  sdk/             -- 纯类型定义（零依赖）
  tools/           -- 16 个内置工具（文件 · 网络 · 系统 · 工具 · 记忆）
  observability/   -- Span · Tracer · Metrics + OpenTelemetry 桥接
  core/            -- Agent · Pipeline · LLMInvoker · 编排 · TaskQueue · Session
  plugins/         -- 15+ 处理器插件
  server/          -- HTTP 服务器 · A2A 协议 · CLI · Studio UI
```

## 🏭 生产就绪

<details>
<summary>配置</summary>

多层 JSONC 配置（优先级从高到低）：

1. **会话级** — 传入 `agent.run()` 的运行时参数
2. **项目级** — `.agentforge/config.jsonc`
3. **全局级** — `~/.agentforge/config.jsonc`

```jsonc
// .agentforge/config.jsonc
{
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "你是一个有帮助的助手。",
      "maxIterations": 5
    }
  }
}
```

</details>

<details>
<summary>CLI</summary>

```bash
npx agentforge serve --port 3000 --api-key secret   # 启动服务器
npx agentforge serve --studio                        # 启动时可观测性 UI：/studio
npx agentforge run --agent assistant --input "你好"  # 单次调用
npx agentforge dev --config .agentforge/config.jsonc # 开发模式（监听变更）
```

</details>

<details>
<summary>API 端点</summary>

```
GET  /health/live                    GET  /sessions
POST /agents/:id/run                 GET  /sessions/:id
GET  /agents/:id/stream (SSE)        GET  /sessions/:id/messages
POST /sessions/:id/prompt            POST /sessions/:id/abort
GET  /permissions/pending            POST /permissions/pending/:id/respond
GET  /providers                      GET  /mcp / POST /mcp
GET  /api/studio/traces              GET  /api/studio/metrics
GET  /api/studio/sessions            GET  /studio/* (SPA)
```

</details>

<details>
<summary>Docker</summary>

```bash
docker compose up
```

容器暴露 3000 端口并内置健康检查。将配置挂载至 `/app/.agentforge/`。

</details>

---

## 🤝 参与贡献

开发命令与架构详情请参阅 [CLAUDE.md](./CLAUDE.md)。

## 许可证

MIT
