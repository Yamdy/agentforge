# 基本 Agent 示例

学习如何创建和使用基本的 Agent。

## 创建简单 Agent

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  agent: {
    name: 'My Assistant',
    model: 'gpt-4o',
    maxSteps: 10,
  },
});

const result = await agent.run('Hello, how are you?');
console.log(result);
```

## 使用配置文件

### primo.config.md

```markdown
---
name: my-assistant
agent:
  name: My Assistant
  model: gpt-4o
  maxSteps: 15
  temperature: 0.7
  tools:
    - read
    - write
    - ls
    - bash
---

You are a helpful AI assistant. Assist users with their tasks efficiently.
```

### 加载配置

```typescript
import { loadConfig, createAgent } from 'agentforge';

const config = await loadConfig();
const agent = createAgent(config);

const result = await agent.run('Help me with my project');
console.log(result);
```

## 使用内置工具

```typescript
const agent = createAgent({
  agent: {
    name: 'File Assistant',
    model: 'gpt-4o',
    tools: ['read', 'write', 'ls'],
  },
});

// Agent 可以自动使用这些工具
const result = await agent.run('读取 package.json 文件');
console.log(result);
```

## 流式响应

```typescript
agent.runStream('Tell me a story').subscribe({
  next: (event) => {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.content);
        break;
      case 'tool_call_start':
        console.log(`\n[调用工具: ${event.name}]`);
        break;
      case 'tool_call_end':
        console.log(`\n[工具完成]`);
        break;
    }
  },
  complete: () => {
    console.log('\n[完成]');
  },
});
```

## 监听事件

```typescript
agent.on('state_change', (state) => {
  console.log('Agent 状态:', state);
});

agent.on('tool_call', (toolCall) => {
  console.log('工具调用:', toolCall.tool.name);
});

agent.on('error', (error) => {
  console.error('错误:', error);
});

const result = await agent.run('Do something');
```

## 控制执行

```typescript
// 暂停
await agent.pause();

// 恢复
await agent.resume();

// 取消
await agent.cancel();
```

## 完整示例

```typescript
import 'dotenv/config';
import { loadConfig, createAgent } from 'agentforge';

async function main() {
  // 加载配置
  const config = await loadConfig();
  console.log('Agent 名称:', config.agent.name);

  // 创建 Agent
  const agent = createAgent(config);

  // 监听事件
  agent.on('state_change', (state) => {
    console.log('状态改变:', state);
  });

  agent.on('tool_call', (toolCall) => {
    console.log('工具调用:', toolCall.tool.name);
  });

  // 运行 Agent
  console.log('\n运行 Agent...');
  const result = await agent.run('你好！请介绍一下自己。');

  console.log('\n结果:');
  console.log(result);

  // 流式运行
  console.log('\n流式运行...');
  agent.runStream('用一句话概括今天').subscribe({
    next: (event) => {
      if (event.type === 'text') {
        process.stdout.write(event.content);
      }
    },
    complete: () => {
      console.log('\n\n流式完成');
    },
  });
}

main().catch(console.error);
```

## 运行示例

```bash
# 安装依赖
pnpm install

# 运行示例
pnpm tsx examples/basic-agent.ts
```

## 下一步

- [流式响应示例](./streaming.md) - 学习流式响应
- [工具使用示例](./tools.md) - 学习使用工具
