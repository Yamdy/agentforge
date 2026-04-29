# 简介

AgentForge 是一个生产级的 Agent 框架，专注于类型安全和异步事件流处理。

## 为什么选择 AgentForge？

### 🔄 事件驱动架构

AgentForge 采用 Promise 模式作为默认调用方式，让开发者可以轻松上手：

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// 运行 Agent（Promise 模式）
const result = await agent.run('Hello!');
console.log(result);
```

### 🛡️ 类型安全

所有事件和状态都有 Zod schema 定义：

```typescript
// 类型安全的 API
const result = await agent.run('Hello!');

// TypeScript 自动推断返回类型
console.log(result); // string 类型
```

### 🔌 插件扩展

通过插件横向扩展能力：

```typescript
import { loggingPlugin, metricsPlugin } from 'agentforge/plugins';

agent.use(loggingPlugin);
agent.use(metricsPlugin);
```

## 核心特性

| 特性 | 描述 |
|------|------|
| **事件流** | 50+ 种事件类型，完整追踪 Agent 行为 |
| **状态管理** | 不可变状态，支持 Checkpoint 恢复 |
| **工具调用** | 自动处理工具定义和调用流程 |
| **流式输出** | 支持 LLM 流式响应，实时输出 |
| **HITL** | Human-in-the-loop 人工干预支持 |
| **MCP** | Model Context Protocol 原生支持 |
| **子 Agent** | 嵌套 Agent 执行，错误隔离 |
| **工作流** | 顺序/并行工作流编排 |

## 设计哲学

### 1. 错误即事件

所有错误都转换为异常抛出，可以用标准的 try-catch 处理：

```typescript
// 错误处理（框架自动处理）
try {
  const result = await agent.run('...');
  console.log(result);
} catch (error) {
  // 优雅处理错误
  console.error('Agent error:', error);
}
```

### 2. 轻量 DI

不使用 IoC 容器，通过闭包注入依赖：

```typescript
const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  llm: myCustomLLMAdapter,      // 注入自定义 LLM
  tools: myToolRegistry,         // 注入工具注册表
  checkpoint: myCheckpointStorage, // 注入存储
});
```

### 3. 可观测优先

每个步骤都发出事件，便于追踪和调试：

```
agent.start → agent.step → llm.request → llm.response → tool.call → tool.result → agent.complete
```

## 与其他框架对比

| 特性 | AgentForge | LangChain | AutoGen |
|------|------------|-----------|---------|
| **核心抽象** | Observable 事件流 | Chain | Agent |
| **类型安全** | Zod 运行时校验 | Pydantic | 无 |
| **流式处理** | 原生支持 | 需要适配 | 部分支持 |
| **取消机制** | 内置 | 需要手动实现 | 无 |
| **错误处理** | 错误即事件 | try-catch | try-catch |
| **插件系统** | 拦截器 + 观察者 | 回调 | 无 |

## 进阶用法

除了 Promise 模式，AgentForge 也提供 Observable 模式，适合需要精细控制流的高级场景：

```typescript
import { createAgent } from 'agentforge';
import { filterEventType, takeUntilTerminal } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// Observable 模式：订阅事件流
agent.run$('Hello!').pipe(
  filterEventType('llm.response'),
  takeUntilTerminal('done')
).subscribe({
  next: (event) => console.log('LLM:', event.content),
  complete: () => console.log('Done'),
});
```

使用 Observable 模式时，你可以：

- **实时监控**：监听每个中间步骤的事件
- **取消执行**：随时取消未完成的 Agent 运行
- **链式操作**：使用 RxJS 操作符组合复杂逻辑
- **超时重试**：内置基于事件的超时和重试机制

更多详情，请参考 [核心概念](/guide/core-concepts) 章节。

## 下一步

- [快速开始](/guide/getting-started) - 5 分钟上手 AgentForge
- [核心概念](/guide/core-concepts) - 理解事件流和状态管理
- [API 参考](/api/) - 完整的 API 文档
