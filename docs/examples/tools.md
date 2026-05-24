# 工具使用示例

学习如何在 Agent 中使用工具。

## 使用内置工具

### 基本用法

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  agent: {
    name: 'File Assistant',
    model: 'gpt-4o',
    tools: ['read', 'write', 'ls', 'bash'],
  },
});

// Agent 会自动使用这些工具
const result = await agent.run('读取 package.json 文件并告诉我依赖');
console.log(result);
```

### 指定工具

```typescript
const agent = createAgent({
  agent: {
    name: 'Reader',
    model: 'gpt-4o',
    tools: ['read', 'ls'], // 只启用读取工具
  },
});

const result = await agent.run('列出当前目录的文件');
```

## 工具调用示例

### 读取文件

```typescript
const agent = createAgent({
  agent: {
    name: 'File Reader',
    model: 'gpt-4o',
    tools: ['read'],
  },
});

const result = await agent.run('读取 README.md 文件');
console.log(result);
```

### 写入文件

```typescript
const agent = createAgent({
  agent: {
    name: 'File Writer',
    model: 'gpt-4o',
    tools: ['read', 'write'],
  },
});

const result = await agent.run('创建一个 hello.txt 文件，内容是 "Hello, World!"');
```

### 列出目录

```typescript
const agent = createAgent({
  agent: {
    name: 'Directory Lister',
    model: 'gpt-4o',
    tools: ['ls'],
  },
});

const result = await agent.run('列出 src 目录下的所有文件');
```

### 执行命令

```typescript
const agent = createAgent({
  agent: {
    name: 'Command Executor',
    model: 'gpt-4o',
    tools: ['bash'],
  },
});

const result = await agent.run('运行 npm test 命令');
```

## 组合工具使用

```typescript
const agent = createAgent({
  agent: {
    name: 'Multi-tool Assistant',
    model: 'gpt-4o',
    tools: ['read', 'write', 'ls', 'bash'],
  },
});

const result = await agent.run(`
  1. 列出当前目录的文件
  2. 读取 package.json
  3. 创建一个 summary.md 文件，包含项目信息
`);
```

## 工具调用监听

```typescript
agent.on('tool_call', (toolCall) => {
  console.log('工具调用:', toolCall.tool.name);
  console.log('参数:', toolCall.args);
});

agent.on('tool_call_end', (result) => {
  console.log('工具结果:', result.result);
});

const result = await agent.run('使用工具完成任务');
```

## 流式监控工具调用

```typescript
agent.runStream('分析项目结构').subscribe({
  next: (event) => {
    switch (event.type) {
      case 'tool_call_start':
        console.log(`[开始] ${event.name}`);
        break;
      case 'tool_call_end':
        console.log(`[完成] ${event.name}`);
        break;
      case 'text':
        process.stdout.write(event.content);
        break;
    }
  },
});
```

## 权限控制

```typescript
import { hitlMiddleware } from 'agentforge/middleware';

const agent = createAgent({
  agent: {
    name: 'Secure Agent',
    model: 'gpt-4o',
    tools: ['read', 'write', 'ls', 'bash'],
  },
});

// 添加 HITL 中间件，需要人工确认敏感操作
agent.use(
  hitlMiddleware({
    tools: ['delete', 'write', 'bash'],
    prompt: '是否批准此操作？',
  })
);

const result = await agent.run('删除所有 .log 文件');
```

## 自定义工具注册

```typescript
import { Tool } from 'agentforge/types';

const httpTool: Tool = {
  name: 'http_request',
  description: '发送 HTTP 请求',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'DELETE'],
        default: 'GET',
      },
    },
    required: ['url'],
  },
  async execute(args) {
    const response = await fetch(args.url, {
      method: args.method,
    });
    return await response.text();
  },
};

const agent = createAgent({
  agent: {
    name: 'HTTP Agent',
    model: 'gpt-4o',
  },
});

agent.registry.register([httpTool]);

const result = await agent.run('访问 https://api.github.com 获取信息');
```

## 工具执行限制

```typescript
const agent = createAgent({
  agent: {
    name: 'Limited Agent',
    model: 'gpt-4o',
    tools: ['read', 'write'],
    maxSteps: 5, // 限制最多执行5步
  },
});

const result = await agent.run('执行一个复杂的任务');
```

## 错误处理

```typescript
agent.on('error', (error) => {
  if (error instanceof ToolExecutionError) {
    console.error('工具执行失败:', error.toolName);
    console.error('错误:', error.message);
  }
});

try {
  const result = await agent.run('执行任务');
} catch (error) {
  console.error('Agent 执行失败:', error);
}
```

## 完整示例

```typescript
import 'dotenv/config';
import { createAgent } from 'agentforge';
import { Tool } from 'agentforge/types';

// 创建自定义工具
const calculatorTool: Tool = {
  name: 'calculator',
  description: '执行数学计算',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式',
      },
    },
    required: ['expression'],
  },
  async execute(args) {
    try {
      const result = eval(args.expression);
      return { result, success: true };
    } catch (error) {
      return {
        result: null,
        success: false,
        error: error.message,
      };
    }
  },
};

async function main() {
  // 创建 Agent
  const agent = createAgent({
    agent: {
      name: 'Tool Demo',
      model: 'gpt-4o',
      tools: ['read', 'ls'],
      maxSteps: 10,
    },
  });

  // 注册自定义工具
  agent.registry.register([calculatorTool]);

  // 监听工具调用
  agent.on('tool_call', (toolCall) => {
    console.log(`\n[工具调用] ${toolCall.tool.name}`);
    console.log('参数:', JSON.stringify(toolCall.args, null, 2));
  });

  console.log('Agent 工具使用示例\n');
  console.log('='.repeat(50));

  // 示例1: 使用内置工具
  console.log('\n示例1: 列出目录文件');
  const result1 = await agent.run('列出当前目录的所有 TypeScript 文件');
  console.log(result1);

  // 示例2: 使用自定义工具
  console.log('\n示例2: 使用计算器工具');
  const result2 = await agent.run('计算 15 * 23 + 100');
  console.log(result2);

  // 示例3: 组合使用多个工具
  console.log('\n示例3: 组合使用工具');
  const result3 = await agent.run(`
    1. 列出 src 目录下的文件
    2. 计算 100 * 50
    3. 总结结果
  `);
  console.log(result3);
}

main().catch(console.error);
```

## 运行示例

```bash
# 运行示例
pnpm tsx examples/tools.ts
```

## 最佳实践

1. **合理选择工具**：只启用需要的工具
2. **限制执行步数**：设置 maxSteps 避免无限循环
3. **监控工具调用**：监听工具调用事件
4. **错误处理**：妥善处理工具执行错误
5. **权限控制**：对敏感操作使用权限检查

## 下一步

- [自定义工具示例](./custom-tools.md) - 创建自定义工具
- [中间件示例](./middleware.md) - 使用中间件
