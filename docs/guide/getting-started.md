# 快速开始

本指南将帮助你在 5 分钟内创建第一个 Agent。

## 安装

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
import { firstValueFrom } from 'rxjs';

// 创建 Agent
const agent = createAgent({
  name: 'assistant',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
  },
});

// 运行 Agent
const result = await firstValueFrom(agent.run('What is 2 + 2?'));

console.log(result);
// 输出: "2 + 2 equals 4."
```

### 2. 订阅事件流

```typescript
import { createAgent } from 'agentforge';
import { tap, toArray } from 'rxjs/operators';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// 订阅所有事件
await firstValueFrom(
  agent.run('Tell me a joke').pipe(
    tap((event) => {
      console.log(`[${event.type}]`, event);
    }),
    toArray(),
  )
);
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

const result = await firstValueFrom(
  agent.run('What is the weather in Tokyo?')
);
```

### 4. 使用流式输出

```typescript
import { createAgent } from 'agentforge';
import { filter } from 'rxjs/operators';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  streaming: true, // 启用流式输出
});

// 只订阅文本块
agent.run('Write a short story about a robot').pipe(
  filter((event) => event.type === 'llm.stream.text'),
).subscribe({
  next: (event) => {
    if (event.type === 'llm.stream.text') {
      process.stdout.write(event.delta); // 实时输出
    }
  },
});
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

AgentForge 采用"错误即事件"模式，所有错误都作为事件发出：

```typescript
agent.run('...').subscribe({
  next: (event) => {
    if (event.type === 'agent.error') {
      console.error('Agent error:', event.error);
    }
  },
  complete: () => {
    console.log('Stream completed (includes error termination)');
  },
});
```

## 下一步

- [核心概念](/guide/core-concepts) - 深入理解事件流
- [API 参考](/api/) - 完整 API 文档
