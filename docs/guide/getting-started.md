# 快速开始

> **AgentForge 是什么？**  
> AgentForge 是一个 **Agent 开发框架底座（Harness）**，核心理念是：  
> **模型是认知决策核心，框架是工程管控基座。**  
> 所有 Agent 行为必须经过 Harness 管控，不可绕过。

本指南将帮助你在 5 分钟内创建第一个 Agent。

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
import type { LLMAdapter, LLMResponse } from 'agentforge';
import { Observable } from 'rxjs';

class MyCustomLLMAdapter implements LLMAdapter {
  readonly name = 'my-custom-llm';
  readonly provider = 'custom';

  async chat(messages, options) {
    // 实现你的 LLM 调用逻辑
    const response = await fetch('https://my-llm-api.com/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, ...options }),
    });

    return response.json() as Promise<LLMResponse>;
  }

  stream(messages, options) {
    return new Observable((subscriber) => {
      // 实现流式输出
      // subscriber.next({ text: 'chunk' });
      // subscriber.complete();
    });
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

## 高级用法：Observable 模式

如果你需要更细粒度的控制事件流，可以使用底层的 Observable API。

### 获取 Observable 流

```typescript
import { createAgent } from 'agentforge';
import { firstValueFrom } from 'rxjs';
import { filter, tap } from 'rxjs/operators';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// 获取 Observable 流
const observable$ = agent.run('...');

// 方式一：转换为 Promise
const result = await firstValueFrom(observable$);

// 方式二：订阅并处理特定事件
observable$.pipe(
  filter((event) => event.type === 'llm.response'),
  tap((event) => console.log('LLM 响应:', event))
).subscribe({
  next: (event) => console.log(event),
  complete: () => console.log('完成'),
});
```

### 操作符组合

AgentForge 提供了一系列 RxJS 操作符用于高级场景：

```typescript
import { createAgent } from 'agentforge';
import { timeoutOnEventType, retryOnEventType, takeUntilTerminal } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

agent.run('...').pipe(
  // 30 秒内未完成则超时
  timeoutOnEventType('done', 30000),
  // 遇到错误时重试 3 次
  retryOnEventType('agent.error', 3),
  // 直到完成或错误事件
  takeUntilTerminal(),
).subscribe({
  next: (event) => console.log(event.type),
  complete: () => console.log('完成'),
});
```

> 注意：Observable 模式适合需要精细控制事件流的场景，如超时处理、重试逻辑、自定义事件过滤等。对于大多数应用场景，Promise 模式或 stream 回调方法已经足够。

## 下一步

- [核心概念](/guide/core-concepts) - 深入理解事件流
- [API 参考](/api/) - 完整 API 文档
