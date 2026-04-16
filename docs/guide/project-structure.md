# 项目结构

了解 AgentForge 项目的典型结构和组织方式。

## 典型项目结构

```
my-agent-app/
├── primo.config.md          # Agent 配置文件
├── package.json
├── tsconfig.json
├── src/
│   ├── agents/              # 自定义 Agent
│   ├── tools/               # 自定义工具
│   ├── middleware/          # 自定义中间件
│   └── index.ts             # 入口文件
├── examples/                # 示例代码
└── tests/                   # 测试文件
```

## 配置文件

### primo.config.md

主要的 Agent 配置文件，使用 Markdown frontmatter 格式：

```markdown
---
name: my-assistant
version: 1.0.0
agent:
  name: My Assistant
  model: gpt-4o
  maxSteps: 20
  temperature: 0.3
  tools:
    - read
    - write
    - ls
    - bash
model:
  apiKey: ${OPENAI_API_KEY}
server:
  port: 3000
logging:
  level: debug
---

You are an expert AI assistant.
```

### 环境变量

创建 `.env` 文件存储敏感信息：

```env
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
```

## 源代码组织

### 自定义 Agent

```typescript
// src/agents/code-assistant.ts
import { Agent } from 'agentforge';

export class CodeAssistant extends Agent {
  constructor() {
    super(adapter, history, registry, {
      name: 'Code Assistant',
      maxSteps: 30,
    });
  }
}
```

### 自定义工具

```typescript
// src/tools/my-tool.ts
import { Tool } from 'agentforge/types';

export const MyTool: Tool = {
  name: 'my-tool',
  description: '我的自定义工具',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '参数1' },
    },
    required: ['param1'],
  },
  async execute(args) {
    return `执行结果: ${args.param1}`;
  },
};
```

### 自定义中间件

```typescript
// src/middleware/logger.ts
import { Middleware } from 'agentforge/types';

export const loggerMiddleware: Middleware = {
  name: 'logger',
  async beforeToolCall(context) {
    console.log(`执行工具: ${context.tool.name}`);
  },
  async afterToolCall(context) {
    console.log(`工具执行完成: ${context.result}`);
  },
};
```

## 入口文件

```typescript
// src/index.ts
import { loadConfig } from 'agentforge/config';
import { createAgent } from 'agentforge/agent';
import { startServer } from 'agentforge/server';
import { MyTool } from './tools/my-tool';
import { loggerMiddleware } from './middleware/logger';

async function main() {
  const config = await loadConfig();
  const agent = createAgent(config);

  // 注册自定义工具
  agent.registry.register([MyTool]);

  // 添加中间件
  agent.use(loggerMiddleware);

  // 启动服务器
  if (config.server) {
    startServer(agent, config.server);
  }

  // 运行 Agent
  const result = await agent.run('Hello!');
  console.log(result);
}

main();
```

## 测试文件

```typescript
// tests/agent.test.ts
import { describe, it, expect } from 'vitest';
import { createAgent } from 'agentforge/agent';

describe('Agent', () => {
  it('should respond to messages', async () => {
    const agent = createAgent({
      agent: {
        name: 'Test Agent',
        model: 'gpt-4o',
      },
    });

    const result = await agent.run('Hello');
    expect(result).toBeTruthy();
  });
});
```

## 下一步

- [配置系统](./configuration.md) - 了解配置选项
- [Agent API](./agent.md) - 深入了解 Agent
- [工具系统](./tools.md) - 学习工具开发
