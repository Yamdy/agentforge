# createAgent API

`createAgent` 是 AgentForge 的 L2 配置式 API，通过声明式配置创建 Agent 实例。

## 函数签名

```typescript
function createAgent(config: AgentConfig): CreateAgentResult;
```

## AgentConfig

```typescript
interface AgentConfig {
  // Agent 标识
  name?: string;

  // 模型配置（必填）
  model: AgentModelConfig | ModelSpec;

  // LLM 选项
  llmOptions?: Record<string, unknown>;

  // 执行配置
  maxSteps?: number;           // 默认 10
  parallelToolCalls?: boolean; // 默认 true
  streaming?: boolean;         // 默认 false
  timeout?: number;

  // 重试配置
  retry?: number;              // 默认 0
  retryDelay?: number;         // 默认 1000ms
  maxLLMRepairAttempts?: number; // 默认 3

  // 系统提示词
  systemPrompt?: string;

  // 对话历史（多轮对话）
  history?: Message[];

  // 工具配置
  tools?: Array<ToolDefinition | string>;

  // LLM 适配器（可选，优先级高于 model）
  llmAdapter?: LLMAdapter;

  // 持久化
  checkpoint?: boolean | CheckpointConfig;

  // 可观测性
  tracing?: boolean | TracingConfig;
  metrics?: boolean | MetricsConfig;

  // Hook 配置（替代旧版操作符）
  hooks?: {
    request?: RequestHook[];
    tool?: ToolHook[];
    lifecycle?: LifecycleHook[];
  };

  // HITL 配置
  hitl?: HITLConfig;

  // 子 Agent 配置
  subagents?: SubagentConfig[];

  // MCP 服务器配置
  mcpServers?: MCPServerConfig[];
}
```

## Agent 接口

```typescript
interface Agent {
  // Promise 模式：返回最终结果
  run(input: string): Promise<string>;

  // 流式模式：回调处理
  stream(input: string, handlers: StreamHandlers): Promise<void>;

  // 事件监听（替代旧版 Observable）
  on(eventType: string, handler: (event: AgentEvent) => void): () => void;
  onAny(handler: (event: AgentEvent) => void): () => void;
  run$(input: string): any; // @deprecated 使用 run() + on() 替代

  // 控制
  cancel(reason?: string): void;
  pause(): Promise<Checkpoint>;
  resume(checkpoint: Checkpoint): Promise<string>;

  // 动态配置
  registerTool(tool: ToolDefinition | ToolDefinition[]): this;
}
```

## 使用示例

### 基础使用

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  maxSteps: 10,
});

// Promise 模式
const result = await agent.run('Hello, how are you?');
console.log(result);
```

### 流式响应

```typescript
const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  streaming: true,
});

agent.stream('Tell me a story', {
  onText: (delta) => process.stdout.write(delta),
  onComplete: (output) => console.log('\nDone:', output),
  onError: (error) => console.error(error),
});
```

### 带工具的 Agent

```typescript
import { z } from 'zod';

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  tools: [
    {
      name: 'search',
      description: 'Search the web',
      parameters: z.object({ query: z.string() }),
      execute: async (args) => `Results for: ${args.query}`,
    },
    {
      name: 'calculate',
      description: 'Perform calculations',
      parameters: z.object({ expression: z.string() }),
      execute: async (args) => eval(args.expression).toString(),
    },
  ],
});
```

### 生产环境配置

```typescript
const agent = createAgent({
  name: 'production-agent',
  model: { provider: 'openai', model: 'gpt-4o' },
  maxSteps: 20,
  timeout: 60000,
  retry: 3,
  checkpoint: { storage: 'memory', interval: 'llm_response' },
  preset: 'production',
});
```

### 事件监听模式

```typescript
const agent = createAgent({ model: 'openai/gpt-4o', streaming: true });

// 监听流式文本
agent.on('llm.stream.text', (event) => {
  process.stdout.write(event.delta);
});

// 监听所有事件
agent.onAny((event) => {
  console.log(`[${event.type}]`, event);
});

const result = await agent.run('Hello');
console.log('\nDone:', result);
```

### 使用自定义 LLM Adapter

```typescript
import { OpenAIAdapter } from 'agentforge/adapters';

const customAdapter = new OpenAIAdapter('gpt-4o', {
  baseURL: 'https://api.custom-provider.com/v1',
});

const agent = createAgent({
  name: 'custom-agent',
  llmAdapter: customAdapter,
  tools: [],
});
```

### 多轮对话（History）

通过 `history` 字段传入之前的对话记录，实现多轮对话上下文：

```typescript
const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  history: [
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
    { role: 'user', content: 'What are its benefits?' },
    { role: 'assistant', content: 'Key benefits include type safety, better IDE support, and easier refactoring.' },
  ],
});

// LLM 会看到完整的历史上下文
const result = await agent.run('Can you summarize what we discussed?');
```

配合持久化存储实现完整的对话管理：

```typescript
import { createAgent } from 'agentforge';
import { SqliteCheckpointStorage } from 'agentforge/storage';

// 从存储加载历史消息
const history = await loadConversationHistory(sessionId);

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  history,  // 传入历史消息
  tools: [myTool],
});

const result = await agent.run(userMessage);

// 保存新的对话消息
await saveConversationHistory(sessionId, [
  ...history,
  { role: 'user', content: userMessage },
  { role: 'assistant', content: result },
]);
```

## 默认配置

```typescript
const DEFAULT_AGENT_CONFIG = {
  name: 'agent',
  maxSteps: 10,
  parallelToolCalls: true,
  streaming: false,
  retry: 0,
  retryDelay: 1000,
  maxLLMRepairAttempts: 3,
};
```

## StreamHandlers

```typescript
interface StreamHandlers {
  onEvent?: (event: AgentEvent) => void;
  onText?: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, isError: boolean) => void;
  onStep?: (step: number, maxSteps: number) => void;
  onComplete?: (output: string) => void;
  onError?: (error: Error) => void;
}
```

## 相关 API

- [AgentEvent](/api/events) - 事件类型
- [LLMAdapter](/api/llm-adapter) - LLM 适配器
- [ToolDefinition](/api/tool-definition) - 工具定义

## 设计文档对照

| 主题 | 文档 |
|------|------|
| Agent 创建 API | [createAgent](/api/create-agent) |
| AgentContext 3 层 DI | [核心概念](/guide/core-concepts) |
| Hook 系统 | [插件系统](/guide/plugins) |