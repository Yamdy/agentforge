# Getting Started

AgentForge 快速入门指南。从零开始创建并运行你的第一个 Agent。

---


::: tip 零配置可观测性
AgentForge 自动检测  环境变量。设置后无需任何代码即可将 trace 导出到 Jaeger、Grafana Tempo、Datadog 等 OTLP 兼容后端。
:::

## 前置要求

- **Node.js** >= 18
- **pnpm** >= 9（`npm install -g pnpm`）
- 至少一个 LLM API Key（DeepSeek、OpenAI、Anthropic 或 Google）

## 安装

```bash
npm install @primo-ai/core @primo-ai/sdk @primo-ai/tools
```

根据需要安装额外包：

| 包 | 用途 |
|---|---|
| `@primo-ai/sdk` | 类型定义（零依赖） |
| `@primo-ai/core` | Agent、Pipeline、模型解析 |
| `@primo-ai/tools` | 16 个内置工具（http、文件、shell、web、memory 等） |
| `@primo-ai/plugins` | 插件（memory、compression、MCP 等） |
| `@primo-ai/observability` | OpenTelemetry 桥接 |

> 想要参与开发？参见仓库 README 中的贡献指南。

### Provider SDK

AgentForge 基于 [AI SDK](https://sdk.vercel.ai)，需额外安装对应 provider：

```bash
# DeepSeek / OpenAI
npm install @ai-sdk/openai
# Anthropic
npm install @ai-sdk/anthropic
# Google
npm install @ai-sdk/google
```

## 最小示例

创建一个能回显消息的 Agent：

```ts
import { Agent } from '@primo-ai/core';
import { echoTool } from '@primo-ai/tools';
import { registerProvider } from '@primo-ai/core';

// 1. 注册 LLM provider
registerProvider('deepseek', (modelId: string) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  return sdk.languageModel(modelId);
});

// 2. 创建 Agent
const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: '你是一个友好的助手。用中文回答。',
  tools: [echoTool],
  maxIterations: 3,
});

// 3. 运行
const { response } = await agent.run('你好，请帮我回显一下"Hello AgentForge"');
console.log(response);
```

运行：

```bash
DEEPSEEK_API_KEY=sk-xxx npx tsx your-file.ts
```

## 内置工具

`@primo-ai/tools` 提供 16 个开箱即用的工具，零外部依赖：

| 工具 | 说明 |
|------|------|
| `echoTool` | 回显消息（测试用） |
| `httpTool` | HTTP 请求 (GET/POST/PUT/PATCH/DELETE) |
| `fileReadTool` | 读取文件 |
| `fileWriteTool` | 写入文件 |
| `fileEditTool` | 精确字符串替换 |
| `globTool` | 文件模式匹配查找 |
| `grepTool` | 正则搜索文件内容 |
| `shellTool` | 执行 Shell 命令 |
| `calculatorTool` | 数学表达式求值 |
| `datetimeTool` | 获取当前日期时间 |
| `jsonTool` | JSON 解析/格式化/查询 |
| `webSearchTool` | Web 搜索 |
| `webFetchTool` | Web 页面抓取 |
| `memoryStoreTool` | 存储记忆 |
| `memoryRetrieveTool` | 检索记忆 |
| `memoryListTool` | 列出记忆 |

```ts
import {
  echoTool, httpTool, fileReadTool, fileWriteTool, fileEditTool,
  globTool, grepTool, shellTool, calculatorTool, datetimeTool, jsonTool,
  webSearchTool, webFetchTool,
  memoryStoreTool, memoryRetrieveTool, memoryListTool,
} from '@primo-ai/tools';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  tools: [httpTool, fileReadTool, calculatorTool, datetimeTool, jsonTool],
  maxIterations: 5,
});
```

> 完整 API 参考：[工具 Schema](/api-reference#primo-ai-tools-内置工具)

## 流式输出

使用 `agent.stream()` 获取逐事件流：

```ts
for await (const event of agent.stream('今天天气如何？')) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text);
  } else if (event.type === 'tool_call') {
    console.log(`\n[调用工具: ${event.toolCall.name}]`);
  } else if (event.type === 'complete') {
    console.log('\n--- 完成 ---');
  }
}
```

## 自定义工具

用 Zod 定义 schema：

```ts
import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

const weatherTool: Tool = {
  name: 'getWeather',
  description: '获取指定城市的天气',
  inputSchema: z.object({
    city: z.string().describe('城市名称'),
  }),
  execute: async ({ city }) => {
    return `${city}今天晴，25°C`;
  },
};

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  tools: [weatherTool],
});
```

## 使用插件

插件通过 `plugins` 配置项加载，在 pipeline 中注入处理器、工具和钩子：

```ts
import { memoryPlugin, compressionPlugin } from '@primo-ai/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  plugins: [
    // 记忆插件 — 自动存储和检索对话记忆
    memoryPlugin({
      triggerMode: { type: 'automatic', onLoad: 'always' },
    }),
    // 压缩插件 — 防止上下文溢出
    compressionPlugin({
      maxContextTokens: 8000,
      phases: [{ type: 'truncate', maxLength: 500 }],
    }),
  ],
});
```

## 自定义 Processor

插入自己的逻辑到 pipeline 任意阶段：

```ts
import type { Processor, PipelineContext } from '@primo-ai/sdk';

const loggingProcessor: Processor = {
  stage: 'processOutput',
  async execute(ctx: PipelineContext) {
    console.log(`[输出] ${ctx.iteration.response}`);
    return ctx;
  },
};

agent.pipelineRunner.register(loggingProcessor);
```

## Provider 配置

AgentForge 使用 `"provider/modelId"` 格式指定模型：

| 格式 | Provider | 需要的 SDK 包 |
|------|----------|--------------|
| `openai/gpt-4o` | OpenAI | `@ai-sdk/openai` |
| `anthropic/claude-sonnet-4-6` | Anthropic | `@ai-sdk/anthropic` |
| `google/gemini-2.0-flash` | Google | `@ai-sdk/google` |
| `deepseek/deepseek-v4-flash` | DeepSeek | `@ai-sdk/deepseek` |

### 自定义 Provider

通过 `OpenAICompatibleGateway` 连接任意 OpenAI 兼容端点：

```ts
import { OpenAICompatibleGateway, ModelFactory } from '@primo-ai/core';

// 注册自定义网关
const factory = new ModelFactory();
factory.registerGateway(new OpenAICompatibleGateway({
  name: 'local-llama',
  url: 'http://localhost:11434/v1',
}));

// 使用 ModelFactory 解析模型
const model = await factory.resolve('local-llama/llama3');
```

> **注意**: `GatewayChain` 和 `BuiltInGateway` 未从 `@primo-ai/core` barrel 导出。推荐使用 `ModelFactory` 作为模型解析的规范入口。

### Dynamic 配置

`AgentConfig` 的 `systemPrompt` 和 `maxIterations` 支持 `Dynamic<T>` — 可以是静态值或按请求解析的函数：

```ts
const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: (ctx) => `用户 ${ctx.sessionId} 的专属助手`,
  maxIterations: (ctx) => ctx.input.length > 100 ? 5 : 3,
});
```

## Session 持久化

### JSONL 文件存储（默认）

```ts
import { EventBus, FilesystemSessionStorage, SessionPersistence, SessionManagerImpl } from '@primo-ai/core';

const bus = new EventBus();
const storage = new FilesystemSessionStorage('./sessions');
const persistence = new SessionPersistence(bus, storage);
const sessionMgr = new SessionManagerImpl(storage, bus);

// 开始会话
const session = await sessionMgr.start('你好');

// 暂停（HITL 场景）
await sessionMgr.suspend(session.sessionId, '等待用户确认');

// 恢复
await sessionMgr.resume(session.sessionId, '确认通过，继续');
```

### SQLite 存储（可选）

需要安装 `better-sqlite3`：

```bash
npm install better-sqlite3
```

```ts
import { SqliteSessionStorage } from '@primo-ai/core';

const storage = new SqliteSessionStorage('./sessions.db');
const sessionMgr = new SessionManagerImpl(storage, bus);
```

支持 WAL 模式并发读，消息历史分页查询（`getMessages({ limit: 50, before: 'msg_xxx' })`）。

## Sub-Agent

创建同步子 Agent（作为工具调用）：

```ts
import { createSubAgentTool } from '@primo-ai/core';

const researchTool = createSubAgentTool({
  name: 'researcher',
  description: '研究助手，用于深入调查问题',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: '你是研究专家，提供详细分析。',
  contextPolicy: 'isolated',  // 'isolated' | 'inherit' | 'summary-only'
  maxIterations: 3,
}, agent);

// 将子 Agent 作为工具注册
const mainAgent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  tools: [researchTool],
});
```

## 可观测性

接入 OpenTelemetry：

```ts
import { OTelBridge } from '@primo-ai/observability';

const tracer = new OTelBridge({ tracerProvider: yourOtelProvider });
const agent = new Agent(config, { tracer });
```

Pipeline 每个阶段自动创建 Span，形成追踪树：

```
agent_run
  ├── processor_run (processInput)
  ├── processor_run (buildContext)
  └── model_step (loop iteration 1)
      ├── processor_run (invokeLLM)
      ├── tool_call (getWeather)
      └── processor_run (evaluateIteration)
```

## MCP 集成

通过 MCP 插件连接外部工具服务器：

```ts
import { mcpPlugin } from '@primo-ai/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  plugins: [
    mcpPlugin({
      servers: [{
        name: 'filesystem',
        transport: 'stdio',
        command: 'node',
        args: ['mcp-server-filesystem.js', '/path/to/allowed/dir'],
      }],
    }),
  ],
});
```

MCP 工具会自动以 `serverName__toolName` 格式注册到 Agent。

## Studio — 嵌入式可观测性 UI

AgentForge 内建了一个 Web 可观测性控制台，通过 `--studio` 标志启用：

```bash
agentforge serve --studio --port 3000
```

启动后访问 `http://localhost:3000/studio/` 即可看到：

- **Dashboard** — KPI 卡片（运行次数、平均延迟、Token 用量、预估成本）
- **Traces** — 每次 Agent 运行的完整 Span 时间线
- **Sessions** — 会话列表与详情（消息历史、事件流）
- **暗色/亮色主题** — 一键切换

### 工作原理

```
Agent EventBus  ──→  StudioObservability  ──→  TraceCollector + InMemoryMetrics
                         │
                         ▼
              /api/studio/* (Hono routes)
                         │
                         ▼
              /studio/* (Vue 3 SPA)
```

- `StudioObservability` 通过 `attachAgent(agent)` 订阅 EventBus 的 `agent:start` / `agent:end` 事件
- 自动创建 Trace（含 Span 树）、累计 Metrics、计算 KPI
- 前端通过 `/api/studio/*` REST API 读取数据，`/studio/` 提供 SPA 静态资源

### 编程式使用

```ts
import { AgentForgeServer } from '@primo-ai/server';
import { StudioObservability } from '@primo-ai/server';

const studio = new StudioObservability();
const server = new AgentForgeServer({
  port: 3000,
  studio,
  sessionStorage, // 可选 — 启用后可在 Studio 查看 session 历史
});

// 当通过 config-loader 注册 agent 时，自动 attach
// 也可手动 attach:
studio.attachAgent(agent);

await server.start();
```

> **注意**: `StudioObservability` 当前仅从 `@primo-ai/server` 导出，底层 `TraceCollector` 和 `InMemoryMetrics` 从 `@primo-ai/observability` 导出，可在任意场景使用。

## 自修改安全

AgentForge 内建三层防线，确保 Agent 自修改行为不失控：

1. **Constitution 宪法引擎** — 定义保护路径和风险分级
2. **Verification Gate** — 多门验证管线
3. **Mutation Budget** — 限制修改频率和规模

```ts
import { ConstitutionEngine, VerificationGatePipeline, MutationBudgetEngine } from '@primo-ai/core';

// 1. 定义宪法
const constitution = {
  protectedPaths: [
    { pattern: 'core/**/*.ts', level: 'absolute' },
    { pattern: 'config/**/*.json', level: 'approval' },
  ],
  diffLimits: { maxLinesPerFile: 50, maxFilesPerMutation: 5 },
  approvalMatrix: {
    L0: 'auto',
    L1: 'auto_with_audit',
    L2: 'human_approval',
    L3: 'human_approval',
    L4: 'always_reject',
  },
};

const constitutionEngine = new ConstitutionEngine(constitution);

// 2. 创建验证门管线
const gatePipeline = new VerificationGatePipeline({
  constitutionEngine,
  additionalGates: [],
});

// 3. 配置变异预算
const budgetEngine = new MutationBudgetEngine({
  maxHourlyMutations: 10,
  maxDailyMutations: 50,
  maxLinesPerFile: 100,
});
```

### 退化看门狗

监控 Agent 健康状态，连续失败自动回滚：

```ts
import { DegenerationWatchdog } from '@primo-ai/core';

const watchdog = new DegenerationWatchdog({
  healthChecks: [
    {
      name: 'response-quality',
      check: async () => ({ healthy: true, details: 'OK' }),
    },
  ],
  maxConsecutiveFailures: 3,
  onRollback: () => console.log('回滚到最近健康快照'),
});
```

## 三层认知记忆

模拟人类认知三层架构：

```ts
import { MemorySystem } from '@primo-ai/core';

const memory = new MemorySystem({
  episodic: { store: 'sqlite', path: './memory/episodic.db' },
  semantic: { store: 'sqlite', path: './memory/semantic.db' },
  working: { capacity: 10 },
  embedder: new SimpleEmbedder(),
});

// 存储事件记忆
await memory.remember({
  content: '用户偏好中文回复',
  type: 'preference',
});

// 召回相关记忆
const results = await memory.recall({
  query: '用户语言偏好',
  limit: 5,
});
```

三层记忆也可通过 pipeline processor 自动集成：

```ts
import { createMemoryRecallProcessor, createMemoryStoreProcessor } from '@primo-ai/core';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  plugins: [
    // 自动存储对话到记忆
    { factory: (harness) => ({
      processors: [createMemoryStoreProcessor(memory)],
    }) },
    // 自动从记忆召回上下文
    { factory: (harness) => ({
      processors: [createMemoryRecallProcessor(memory)],
    }) },
  ],
});
```

## 适配器 API

高级 Processor 创建 API — 一行代码替代手写 Processor：

### Modifiers — 修改上下文

```ts
import { modifiers } from '@primo-ai/core';

// 修改消息历史
const msgModifier = modifiers.message((msgs, ctx) => {
  // 注入系统消息到历史头部
  return [{ role: 'user', content: '当前时间: ' + new Date().toISOString() }, ...msgs];
});

// 修改系统提示
const promptModifier = modifiers.systemPrompt((prompt, ctx) => {
  return prompt + '\n\n注意：回答需基于最新数据。';
});

// 动态注入工具
const toolModifier = modifiers.tools((tools, ctx) => {
  return [...tools, { name: 'timeTool', description: '获取当前时间' }];
});
```

### Gates — 控制流门控

```ts
import { gates } from '@primo-ai/core';

// 权限门控
const permGate = gates.permission({
  check: (toolName, args, ctx) => {
    if (toolName === 'shellTool') return 'ask'; // 需要人工审批
    if (toolName === 'fileWriteTool' && args.path.includes('/etc/')) return 'deny';
    return 'allow';
  },
  onDeny: (toolName) => `工具 ${toolName} 被拒绝`,
});

// 配额门控
const quotaGate = gates.quota({
  check: (usage, ctx) => {
    return (usage?.totalTokens ?? 0) < 100000;
  },
  onExceeded: (usage) => `Token 用量超限: ${usage?.totalTokens}`,
});
```

## 生产韧性

### 熔断器

防止级联故障，连续失败自动熔断：

```ts
import { CircuitBreaker } from '@primo-ai/core';

const breaker = new CircuitBreaker({
  failureThreshold: 5,    // 5 次失败后熔断
  resetTimeout: 30000,    // 30 秒后半开试探
  halfOpenMaxRequests: 1, // 半开状态允许 1 次试探
});

// 使用
if (breaker.state === 'closed') {
  try {
    const result = await riskyOperation();
    breaker.recordSuccess();
  } catch (e) {
    breaker.recordFailure();
  }
}
```

### 结构化并发

Runner 提供 Agent 任务的结构化并发管理：

```ts
import { Runner } from '@primo-ai/core';

const runner = new Runner({
  onInterrupt: () => console.log('任务被中断'),
});

const handle = runner.enqueue(async () => {
  return await agent.run('执行任务');
});

// 等待结果
const result = await handle.promise;
```

### 文件审计回滚

SnapshotService 追踪文件变更，支持 diff 和一键回滚：

```ts
import { SnapshotServiceImpl, NodeFsAdapter, InMemorySnapshotStore } from '@primo-ai/core';

const snapshot = new SnapshotServiceImpl({
  adapter: new NodeFsAdapter(),
  store: new InMemorySnapshotStore(),
  patterns: ['src/**/*.ts', 'config/**/*.json'],
});

// 创建快照
const snapId = await snapshot.create();

// 对比差异
const diff = await snapshot.diff(snapId);

// 回滚
await snapshot.revert(snapId);
```

## 下一步

- [API 参考](/api-reference) — 完整的类型和方法文档

## 脚本参考

<!-- AUTO-GENERATED -->
根命令（在仓库根目录运行）：

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建所有包（遵循 turbo 依赖顺序） |
| `pnpm test` | 运行所有测试（先构建） |
| `pnpm lint` | ESLint 检查所有包 |
| `pnpm check-types` | TypeScript 类型检查所有包 |

单包命令：

| 命令 | 说明 |
|------|------|
| `pnpm --filter @primo-ai/core test` | 仅运行 core 包测试 |
| `pnpm --filter @primo-ai/core vitest run __tests__/pipeline.test.ts` | 运行单个测试文件 |
| `cd examples && npx tsx unified-demo.ts` | 运行示例（需要 .env） |
<!-- /AUTO-GENERATED -->
