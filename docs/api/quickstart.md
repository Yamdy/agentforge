# Quickstart API

零配置 API，提供类似 Mastra 的开发体验。

## Agent 类

简化版 Agent 类，自动处理 adapter 注册和 context 构建。

### 创建 Agent

```typescript
import { Agent } from 'agentforge/quickstart';

const agent = new Agent({
  name: 'my-agent',
  model: 'openai/gpt-4o-mini',  // provider/model 格式
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a helpful assistant.',
  tools: { ... },
  maxSteps: 10,
});
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | Agent 名称 |
| `model` | string | ✅ | 模型格式：`provider/model` 或 `model` |
| `apiKey` | string | ❌ | API Key（或通过环境变量） |
| `baseUrl` | string | ❌ | 自定义 API 地址 |
| `systemPrompt` | string | ❌ | 系统提示词 |
| `tools` | Record&lt;string, ToolDefinition&gt; | ❌ | 工具定义（key = 工具名） |
| `maxSteps` | number | ❌ | 最大步骤数（默认 10） |
| `parallelToolCalls` | boolean | ❌ | 并行工具调用（默认 true） |

### 运行 Agent

```typescript
// 生成模式
const result = await agent.generate('Hello');
console.log(result.text);

// 流式模式
agent.stream('Hello', {
  onText: (delta) => process.stdout.write(delta),
  onComplete: (result) => console.log('\nDone'),
});

// Observable 模式
agent.run$('Hello').subscribe(event => console.log(event.type));
```

### 控制

```typescript
agent.cancel();           // 取消执行
const cp = await agent.pause();  // 暂停
await agent.resume(cp);   // 恢复
```

## tool() 函数

简化版工具定义函数。

### 定义工具

```typescript
import { tool } from 'agentforge/quickstart';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get weather for a city',
  parameters: z.object({ city: z.string() }),
  execute: async (args) => {
    return { temperature: 22, city: args.city };
  },
});
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | string | ✅ | 工具描述 |
| `parameters` | z.ZodType | ✅ | 参数 schema |
| `execute` | function | ✅ | 执行函数 |

### 返回值

`execute` 函数可以返回任意类型，会自动序列化为 JSON 字符串。

## 完整示例

```typescript
import { Agent, tool } from 'agentforge/quickstart';
import { z } from 'zod';

// 定义工具
const weatherTool = tool({
  description: 'Get weather for a city',
  parameters: z.object({ city: z.string().describe('City name') }),
  execute: async (args) => {
    return { city: args.city, temp: 22, condition: 'sunny' };
  },
});

// 创建 Agent
const agent = new Agent({
  name: 'weather-agent',
  model: 'openai/gpt-4o-mini',
  systemPrompt: 'You are a helpful weather assistant.',
  tools: { weather: weatherTool },
});

// 运行
const result = await agent.generate('What is the weather in Tokyo?');
console.log(result.text);
```

## 对比 createAgent API

| 功能 | createAgent (L2) | Quickstart |
|------|-----------------|------------|
| 创建 Agent | `createAgent(config)` | `new Agent(config)` |
| 工具定义 | 手动实现 ToolRegistry | `tool({...})` |
| Model 配置 | `{ provider, model }` 对象 | `'provider/model'` 字符串 |
| Adapter 注册 | 手动 `factory.register()` | 自动注册 |
| 返回值 | `string` | `{ text: string }` |
| 适用场景 | 需要细粒度控制 | 快速原型开发 |
