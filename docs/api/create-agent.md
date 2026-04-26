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
  model: AgentModelConfig | string;

  // LLM 选项
  llmOptions?: Record<string, unknown>;

  // 执行配置
  maxSteps?: number;           // 默认 10
  parallelToolCalls?: boolean; // 默认 false
  streaming?: boolean;         // 默认 false
  timeout?: number;

  // 重试配置
  retry?: number;              // 默认 0
  retryDelay?: number;         // 默认 1000ms
  maxLLMRepairAttempts?: number; // 默认 3

  // 工具配置
  tools?: Array<ToolDefinition | string>;

  // LLM 适配器（可选，优先级高于 model）
  llmAdapter?: LLMAdapter;

  // 持久化
  checkpoint?: boolean | CheckpointConfig;

  // 可观测性
  tracing?: boolean | TracingConfig;
  metrics?: boolean | MetricsConfig;

  // 预设
  preset?: 'production' | 'debug' | 'test';

  // 自定义操作符
  operators?: OperatorFunction<AgentEvent>[];

  // HITL 配置
  hitl?: boolean | HITLConfig;

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
  stream(input: string, handlers: StreamHandlers): AgentSubscription;

  // Observable 模式：完全控制
  run$(input: string): Observable<AgentEvent>;

  // 控制
  cancel(reason?: string): void;
  pause(): Promise<Checkpoint>;
  resume(checkpoint: Checkpoint): Promise<string>;

  // 事件监听
  on(eventType: AgentEventType, handler: (event: AgentEvent) => void): () => void;

  // 动态配置
  use(operator: OperatorFunction<AgentEvent>): this;
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

### Observable 模式

```typescript
import { filter, tap } from 'rxjs/operators';

const agent = createAgent({ model: 'openai/gpt-4o' });

agent.run$('Hello')
  .pipe(
    filter(e => e.type === 'llm.stream.text'),
    tap(e => {
      if (e.type === 'llm.stream.text') {
        process.stdout.write(e.delta);
      }
    })
  )
  .subscribe({
    complete: () => console.log('\nDone'),
  });
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

## 默认配置

```typescript
const DEFAULT_AGENT_CONFIG = {
  name: 'agent',
  maxSteps: 10,
  parallelToolCalls: false,
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