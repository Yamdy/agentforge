# Getting Started

AgentForge 快速入门指南。从零开始创建并运行你的第一个 Agent。

---

## 前置要求

- **Node.js** >= 18
- **pnpm** >= 9（`npm install -g pnpm`）
- 至少一个 LLM API Key（DeepSeek、OpenAI、Anthropic 或 Google）

## 安装

```bash
# 克隆仓库
git clone <repo-url> agentforge && cd agentforge

# 安装依赖（pnpm workspace + turbo）
pnpm install

# 构建所有包
pnpm build
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

插件通过 `agent.use()` 加载，在 pipeline 中注入处理器、工具和钩子：

```ts
import { memoryPlugin, InMemoryBackend } from '@primo-ai/plugins';
import { compressionPlugin } from '@primo-ai/plugins';

// 记忆插件 — 自动存储和检索对话记忆
agent.use(memoryPlugin({
  backend: new InMemoryBackend(),
  triggerMode: { type: 'automatic', onLoad: 'always' },
}));

// 压缩插件 — 防止上下文溢出
agent.use(compressionPlugin({
  maxContextTokens: 8000,
  phases: [{ type: 'truncate', maxLength: 500 }],
}));
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

使用 JSONL 文件存储会话历史：

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

agent.use(mcpPlugin({
  servers: [{
    name: 'filesystem',
    transport: 'stdio',
    command: 'node',
    args: ['mcp-server-filesystem.js', '/path/to/allowed/dir'],
  }],
}));
```

MCP 工具会自动以 `serverName__toolName` 格式注册到 Agent。

## 下一步

- [API 参考](/api-reference) — 完整的类型和方法文档
- [迁移指南](/migration-guide) — 从早期版本迁移

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
