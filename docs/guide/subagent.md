# 子 Agent（SubAgent）

AgentForge 支持创建嵌套的子 Agent，允许 Agent 调用其他 Agent 来处理特定任务。

## 概述

子 Agent 是一个独立的 Agent 实例，可以被主 Agent 调用。每个子 Agent 有自己的工具集和配置，专门处理特定类型的任务。

## 创建子 Agent

### 定义子 Agent 配置

```typescript
import { createAgentLoop, SubagentRegistry } from 'agentforge';

const researchAgent = createAgentLoop(researchContext, {
  model: { provider: 'openai', model: 'gpt-4o' },
  maxSteps: 5,
});

const subagentRegistry = new SubagentRegistry();

// 注册子 Agent
subagentRegistry.register({
  name: 'research-agent',
  description: 'Search and summarize information from web sources',
  mode: 'subagent',
  agent: researchAgent,
});

// 注册另一个子 Agent
subagentRegistry.register({
  name: 'code-reviewer',
  description: 'Review code for bugs and improvements',
  mode: 'subagent',
  agent: codeReviewAgent,
});
```

### Agent 模式

| 模式 | 说明 |
|------|------|
| `primary` | 主 Agent，处理用户直接请求 |
| `subagent` | 子 Agent，被主 Agent 调用 |
| `all` | 可以同时作为主 Agent 和子 Agent |

## 使用子 Agent

### 通过 SubagentRegistry

```typescript
// 检查子 Agent 是否存在
if (subagentRegistry.has('research-agent')) {
  // 监听子 Agent 事件
  subagentRegistry.on('subagent.start', (event) => {
    console.log('SubAgent started:', event.subagentName);
  });
  subagentRegistry.on('subagent.complete', (event) => {
    console.log('SubAgent output:', event.output);
  });
  subagentRegistry.on('subagent.error', (event) => {
    console.error('SubAgent failed:', event.error.message);
  });
  
  // 运行子 Agent
  const output = await subagentRegistry.run(
    'research-agent',
    'Search for recent AI breakthroughs'
  );
  console.log('Result:', output);
}
```

### 列出可用子 Agent

```typescript
// 获取所有子 Agent 信息
const subagents = subagentRegistry.list();
console.log(subagents);
// [
//   { name: 'research-agent', mode: 'subagent', description: 'Search and...' },
//   { name: 'code-reviewer', mode: 'subagent', description: 'Review code...' }
// ]

// 获取单个子 Agent 信息
const info = subagentRegistry.get('research-agent');
console.log(info?.description);
```

## 子 Agent 事件流

子 Agent 执行时产生的事件流：

```
subagent.start
    ↓
[嵌套的 agent.* 事件]（带有 parentSessionId）
    ↓
subagent.complete 或 subagent.error
```

### 事件结构

```typescript
interface SubagentStartEvent {
  type: 'subagent.start';
  sessionId: string;
  parentSessionId: string;  // 主 Agent 的 sessionId
  subagentName: string;
  input: string;
}

interface SubagentCompleteEvent {
  type: 'subagent.complete';
  sessionId: string;
  output: string;
}

interface SubagentErrorEvent {
  type: 'subagent.error';
  sessionId: string;
  error: SerializedError;
}
```

## 动态管理

```typescript
// 取消注册子 Agent
subagentRegistry.unregister('old-agent');

// 清空所有子 Agent
subagentRegistry.clear();

// 获取配置信息
const config = subagentRegistry.getConfig('research-agent');
console.log(config?.agent);
```

## 在主 Agent 中集成

将 SubagentRegistry 添加到 AgentContext：

```typescript
import { ContextBuilder } from 'agentforge';

const ctx = ContextBuilder.create()
  .withLLM(myLLMAdapter)
  .withTools([myTools])
  .withSubagents(subagentRegistry)
  .build();

// 主 Agent 现在可以通过工具调用子 Agent
const mainAgent = createAgent({
  name: 'main-agent',
  model: 'openai/gpt-4o',
  llmAdapter: myLLMAdapter,
  subagents: subagentRegistry,
});
```

## 子 Agent 工具调用

主 Agent 可以通过特定工具调用子 Agent：

```typescript
const delegateTool: ToolDefinition = {
  name: 'delegate_to_researcher',
  description: 'Delegate research tasks to research-agent',
  parameters: z.object({
    task: z.string().describe('Task description'),
  }),
  execute: async (args, ctx) => {
    const registry = ctx.subagents;
    if (registry?.has('research-agent')) {
      const result = await registry.run('research-agent', args.task);
      return result ?? 'No result';
    }
    return 'Research agent not available';
  },
  riskLevel: 'medium',
};
```

## 错误处理

子 Agent 错误被转换为事件，不会影响主 Agent 流程：

```typescript
subagentRegistry.on('subagent.error', (event) => {
  console.log('Error name:', event.error.name);
  console.log('Message:', event.error.message);
});

try {
  await subagentRegistry.run('missing-agent', 'task');
} catch {
  // SubagentNotFoundError handled via events
}
```

## 最佳实践

1. **明确职责划分**：每个子 Agent 应有明确的任务范围
2. **限制步骤数**：子 Agent 应有较小的 maxSteps 防止无限循环
3. **隔离工具集**：子 Agent 使用专用工具，避免权限冲突
4. **监控嵌套深度**：避免创建过深的 Agent 嵌套

## 相关 API

- [SubagentRegistry](/api/subagent-registry) - 子 Agent 管理接口
- [AgentContext](/api/state) - 上下文构建器
- [事件系统](/guide/events) - subagent.* 事件类型