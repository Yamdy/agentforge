# 快速开始

欢迎使用 AgentForge！本指南将帮助你快速上手这个强大的 TypeScript Agent 开发框架。

## 安装

### 使用 CLI 创建新项目

```bash
# 创建新项目
npm create agentforge@latest my-agent-app
cd my-agent-app
npm install
npm run dev
```

### 安装到现有项目

```bash
pnpm add agentforge
```

## 创建你的第一个 Agent

### 1. 创建配置文件

在项目根目录创建 `agentforge.config.md`：

```markdown
---
name: my-assistant
agent:
  name: My Assistant
  model: gpt-4o
  maxSteps: 15
---

You are a helpful AI assistant.
```

### 2. 创建并运行 Agent

```typescript
import { loadConfig } from 'agentforge/config';
import { createAgent } from 'agentforge/agent';

// 加载并验证配置
const config = await loadConfig();

// 创建 Agent（所有依赖自动注入）
const agent = createAgent(config);

// 运行 Agent
const result = await agent.run('Hello, how are you?');
console.log(result);
```

## 流式响应

```typescript
import { loadConfigSync, createAgent } from 'agentforge';

const config = loadConfigSync();
const agent = createAgent(config);

agent.runStream('Tell me a story').subscribe((event) => {
  switch (event.type) {
    case 'text':
      process.stdout.write(event.content);
      break;
    case 'tool_call_start':
      console.log(`\n[Calling tool: ${event.name}]`);
      break;
  }
});
```

## 使用内置工具

AgentForge 内置了常用的工具：

- `read` - 读取文件和目录
- `write` - 写入文件
- `ls` - 列出目录内容
- `bash` - 执行 shell 命令

这些工具会自动注册到你的 Agent 中。

## 下一步

- [配置系统](./configuration.md) - 了解完整的配置选项
- [Agent API](./agent.md) - 深入了解 Agent 的功能
- [工具系统](./tools.md) - 学习如何使用和创建工具
- [中间件](./middleware.md) - 使用中间件扩展功能
- [示例](../examples/basic.md) - 查看更多实际示例
