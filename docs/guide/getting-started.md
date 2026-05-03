# 快速开始

> **AgentForge 是什么？**  
> AgentForge 是 **The Harness Engine for Production AI Agents**——审计、沙箱、熔断、配额。  
> 不是新的 Agent 框架，是包裹你现有 Agent 的安全层。所有 Agent 行为必须经过 Harness 管控，不可绕过。

## 30 秒体验

```bash
npx agentforge demo
```

无需 API Key、无需配置。30 秒内看到沙箱拦截、安全守卫、熔断器、配额控制的实际效果。

## 推荐：使用脚手架工具（create-agentforge）

```bash
# 交互模式（推荐）
npx create-agentforge my-agent

# 一键默认配置
npx create-agentforge my-agent --default

# 从示例模板创建
npx create-agentforge my-agent --template weather-agent
```

脚手架将自动生成可运行的 Agent 项目，包含完整的 TypeScript 配置和模块化源码。

## 手动安装

```bash
npm install agentforge
```

### 依赖要求

- Node.js >= 18.0.0
- TypeScript >= 5.0 (推荐)

## 基础使用

### 1. 创建简单 Agent

```typescript
import { createAgent } from 'agentforge';

// 创建 Agent
const agent = createAgent({
  name: 'assistant',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
  },
});

// 运行 Agent（Promise 模式）
const result = await agent.run('What is 2 + 2?');

console.log(result);
// 输出: "2 + 2 equals 4."
```

### 2. 订阅事件流

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// 使用 stream 方法订阅事件
agent.stream('Tell me a joke', {
  onStep: (event) => console.log(`[${event.type}]`, event),
  onComplete: (output) => console.log('完成:', output),
  onError: (error) => console.error('错误:', error),
});
```

事件输出示例：

```
[agent.start] { input: 'Tell me a joke', sessionId: '...' }
[agent.step] { step: 1, maxSteps: 10 }
[llm.request] { messages: [...] }
[llm.response] { content: '...', finishReason: 'stop' }
[agent.complete] { output: '...' }
[done] { reason: 'stop' }
```

### 3. 添加工具

```typescript
import { createAgent } from 'agentforge';
import { z } from 'zod';

// 定义工具
const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
  }),
  execute: async (args: { location: string }) => {
    // 模拟天气 API
    return `Weather in ${args.location}: Sunny, 22°C`;
  },
};

const agent = createAgent({
  name: 'weather-assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  tools: [weatherTool],
});

// Promise 模式
const result = await agent.run('What is the weather in Tokyo?');
console.log(result);
```

### 4. 使用流式输出

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  streaming: true, // 启用流式输出
});

// 使用 stream 方法的回调获取实时文本
agent.stream('Write a short story about a robot', {
  onText: (delta) => process.stdout.write(delta),
  onComplete: (result) => console.log('\n完成'),
});
```

### 5. 多轮对话

通过 `history` 字段传入之前的对话记录，实现多轮对话上下文：

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  history: [
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.' },
  ],
});

// LLM 会看到完整的历史上下文
const result = await agent.run('What are its main benefits?');
// LLM 知道 "its" 指的是 TypeScript
```

配合持久化存储实现完整的对话管理：

```typescript
import { createAgent } from 'agentforge';

// 从存储加载历史消息
const history = await loadConversationHistory(sessionId);

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  history,
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

## 配置 LLM

### OpenAI

```typescript
import { createOpenAIAdapter } from 'agentforge/adapters/openai';

const llm = createOpenAIAdapter('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY,
});

const agent = createAgent({
  name: 'assistant',
  llm, // 注入自定义适配器
});
```

### Anthropic

```typescript
import { createAnthropicAdapter } from 'agentforge/adapters/anthropic';

const llm = createAnthropicAdapter('claude-sonnet-4-5', {
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = createAgent({
  name: 'assistant',
  llm,
});
```

### 自定义 LLM 适配器

> 这是高级用法，大多数用户可以直接使用内置的 OpenAI/Anthropic 适配器，无需关心此部分。

```typescript
import type { LLMAdapter, LLMResponse, LLMChunk } from 'agentforge';

class MyCustomLLMAdapter implements LLMAdapter {
  readonly name = 'my-custom-llm';
  readonly provider = 'custom';

  async chat(messages, options): Promise<LLMResponse> {
    const response = await fetch('https://my-llm-api.com/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, ...options }),
    });
    return response.json() as Promise<LLMResponse>;
  }

  async *stream(messages, options): AsyncGenerator<LLMChunk> {
    // 实现流式输出
    yield { text: 'chunk' };
  }
}

const agent = createAgent({
  name: 'assistant',
  llm: new MyCustomLLMAdapter(),
});
```

## 使用插件

### 内置插件

```typescript
import { loggingPlugin, metricsPlugin } from 'agentforge/plugins';
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  plugins: [loggingPlugin, metricsPlugin],
});
```

### 自定义插件

```typescript
import type { ObserverPlugin } from 'agentforge';

const myPlugin: ObserverPlugin = {
  name: 'my-observer',
  type: 'observer',
  priority: 100,
  eventTypes: ['agent.complete', 'agent.error'], // 只监听这些事件
  enabled: true,
  
  observe(event, ctx) {
    console.log(`[${ctx.sessionId}] ${event.type}`);
  },
};

agent.use(myPlugin);
```

## 错误处理

AgentForge 采用 Promise 风格的错误处理，使用 try-catch 或 .catch()：

```typescript
// 方式一：try-catch
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

try {
  const result = await agent.run('...');
  console.log('成功:', result);
} catch (error) {
  console.error('Agent error:', error);
}
```

```typescript
// 方式二：使用 stream 方法的 onError 回调
agent.stream('...', {
  onStep: (event) => console.log('步骤:', event),
  onComplete: (output) => console.log('完成:', output),
  onError: (error) => console.error('错误:', error),
});
```

## 高级用法：事件订阅

如果你需要更细粒度的控制，可以使用事件订阅 API。

### 监听特定事件

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// 订阅特定事件类型
agent.on('llm.response', (event) => {
  console.log('LLM 响应:', event.content);
});

agent.on('tool.call', (event) => {
  console.log('工具调用:', event.toolName);
});

agent.on('agent.complete', (event) => {
  console.log('完成:', event.output);
});

agent.on('agent.error', (event) => {
  console.error('错误:', event.error.message);
});

// 运行
const result = await agent.run('...');
```

### Hook 系统

AgentForge 通过 Hook 系统实现高级扩展：

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  hooks: {
    request: [{
      name: 'system-prompt',
      async beforeRequest(messages) {
        return [{ role: 'system', content: 'You are helpful.' }, ...messages];
      },
    }],
  },
});

const result = await agent.run('Hello');
```

> 注意：事件订阅模式适合需要精细控制的场景。对于大多数应用场景，Promise 模式或 stream 回调方法已经足够。

## 下一步

- [核心概念](/guide/core-concepts) - 深入理解事件流
- [API 参考](/api/) - 完整 API 文档
