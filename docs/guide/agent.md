# Agent

Agent 是 AgentForge 的核心组件，负责协调工具执行、状态管理和响应生成。

## 创建 Agent

### 使用工厂函数（推荐）

```typescript
import { loadConfig, createAgent } from 'agentforge';

const config = await loadConfig();
const agent = createAgent(config);
```

### 手动创建

```typescript
import { Agent } from 'agentforge';
import { AIAdapter } from 'agentforge/adapters/ai';
import { InMemoryHistory } from 'agentforge/memory';
import { ToolRegistry } from 'agentforge/registry';
import { allBuiltinTools } from 'agentforge/tools';

const adapter = new AIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o',
});

const history = new InMemoryHistory();
const registry = new ToolRegistry();
registry.register(allBuiltinTools);

const agent = new Agent(adapter, history, registry, {
  name: 'My Agent',
  maxSteps: 10,
});
```

## Agent 配置

```typescript
interface AgentOptions {
  name: string; // Agent 名称
  maxSteps?: number; // 最大执行步数
  temperature?: number; // 温度参数
  systemPrompt?: string; // 系统提示词
  middleware?: Middleware[]; // 中间件
}
```

## 运行 Agent

### 单次运行

```typescript
const result = await agent.run('Hello, how are you?');
console.log(result);
```

### 流式运行

```typescript
agent.runStream('Tell me a story').subscribe({
  next: (event) => {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;
      case 'tool_call_start':
        console.log(`\n[Calling tool: ${event.name}]`);
        break;
      case 'tool_call_end':
        console.log(`\n[Tool result: ${event.result}]`);
        break;
      case 'error':
        console.error(`\n[Error: ${event.error}]`);
        break;
    }
  },
  complete: () => {
    console.log('\n[Completed]');
  },
  error: (err) => {
    console.error('Stream error:', err);
  },
});
```

### 运行对话

```typescript
const conversation = await agent.runConversation([
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there!' },
  { role: 'user', content: 'How are you?' },
]);
```

## Agent 状态

Agent 使用状态机管理执行状态：

```typescript
enum AgentState {
  PENDING = 'pending', // 等待执行
  RUNNING = 'running', // 正在执行
  PAUSED = 'paused', // 已暂停
  COMPLETED = 'completed', // 已完成
  CANCELLED = 'cancelled', // 已取消
  ERROR = 'error', // 错误
}
```

### 查询状态

```typescript
console.log(agent.state); // 当前状态
console.log(agent.isRunning()); // 是否正在运行
```

### 控制状态

```typescript
// 暂停执行
await agent.pause();

// 恢复执行
await agent.resume();

// 取消执行
await agent.cancel();
```

## 工具管理

### 注册工具

```typescript
import { MyTool } from './tools/my-tool';

agent.registry.register([MyTool]);
```

### 查询工具

```typescript
const tools = agent.registry.getAll();
const tool = agent.registry.get('my-tool');
```

### 注销工具

```typescript
agent.registry.unregister('my-tool');
```

## 中间件

### 添加中间件

```typescript
import { loggerMiddleware } from './middleware/logger';

agent.use(loggerMiddleware);
```

### 移除中间件

```typescript
agent.unuse('logger');
```

## 历史记录

### 获取历史

```typescript
const history = await agent.getHistory();
console.log(history);
```

### 清空历史

```typescript
await agent.clearHistory();
```

### 保存历史

```typescript
await agent.saveHistory();
```

## 错误处理

```typescript
try {
  const result = await agent.run('Hello');
} catch (error) {
  if (error instanceof ToolExecutionError) {
    console.error('工具执行失败:', error.toolName);
  } else if (error instanceof APIError) {
    console.error('API 错误:', error.message);
  }
}
```

## 事件监听

```typescript
agent.on('state_change', (state) => {
  console.log('状态改变:', state);
});

agent.on('tool_call', (tool) => {
  console.log('工具调用:', tool.name);
});

agent.on('error', (error) => {
  console.error('错误:', error);
});
```

## 完整示例

```typescript
import { loadConfig, createAgent } from 'agentforge';

async function main() {
  const config = await loadConfig();
  const agent = createAgent(config);

  // 监听事件
  agent.on('state_change', (state) => {
    console.log('Agent 状态:', state);
  });

  // 流式运行
  agent.runStream('帮我写一个排序算法').subscribe({
    next: (event) => {
      if (event.type === 'text') {
        process.stdout.write(event.content);
      }
    },
    complete: () => {
      console.log('\n执行完成');
    },
  });
}

main();
```

## 下一步

- [工具系统](./tools.md) - 了解如何使用工具
- [中间件](./middleware.md) - 使用中间件扩展功能
- [流式响应](./streaming.md) - 深入了解流式响应
