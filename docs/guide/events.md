# 事件系统

AgentForge 的核心架构基于 RxJS 事件流。所有操作都是 `Observable<AgentEvent>` 的变换，提供天然的可观测性和可组合性。

## 事件类型

AgentForge 定义了 50+ 种事件类型，分为三层：

### Layer 1: 核心 Agent 循环

| 事件类型 | 说明 | 触发时机 |
|---------|------|---------|
| `agent.start` | Agent 启动 | 会话开始 |
| `agent.step` | 步骤计数更新 | 每次循环迭代 |
| `agent.complete` | Agent 完成 | 成功结束 |
| `agent.error` | Agent 错误 | 错误发生 |
| `llm.request` | LLM 请求发起 | 调用 LLM 前 |
| `llm.response` | LLM 响应接收 | LLM 返回后 |
| `llm.error` | LLM 错误 | LLM 调用失败 |
| `tool.call` | 工具调用发起 | 需要执行工具 |
| `tool.execute` | 工具执行开始 | 工具开始执行 |
| `tool.result` | 工具执行结果 | 工具执行完成 |
| `tool.error` | 工具错误 | 工具执行失败 |
| `hitl.ask` | 请求人工输入 | 需要人工介入 |
| `hitl.answer` | 人工输入响应 | 人工回答后 |
| `done` | 流终止 | 终端事件 |

### Layer 2: 子系统生命周期

| 事件类型 | 说明 |
|---------|------|
| `subagent.start` | 子 Agent 启动 |
| `subagent.complete` | 子 Agent 完成 |
| `mcp.connected` | MCP 连接成功 |
| `mcp.tools_changed` | MCP 工具变更 |
| `workflow.start` | 工作流启动 |
| `workflow.complete` | 工作流完成 |

### Layer 3: 横切关注点

| 事件类型 | 说明 |
|---------|------|
| `checkpoint` | 检查点保存 |
| `state.change` | 状态变更 |
| `cancel` | 取消执行 |

## 事件结构

所有事件都使用 Zod schema 定义，确保运行时类型安全：

```typescript
import { AgentEventSchema, type AgentEvent } from 'agentforge';

// 事件是 discriminated union，通过 type 字段区分
const event: AgentEvent = {
  type: 'agent.start',
  timestamp: 1699123456789,
  sessionId: 'session-abc123',
  input: 'Hello, how can you help?',
  agentName: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
};

// 验证事件
const parsed = AgentEventSchema.safeParse(event);
if (parsed.success) {
  console.log('Valid event:', parsed.data);
}
```

## 类型守卫

AgentForge 提供类型守卫函数来检查事件类型：

```typescript
import {
  isLLMEvent,
  isToolEvent,
  isHITLEvent,
  isTerminalEvent,
  isAgentLifecycleEvent,
} from 'agentforge';

// 检查是否是 LLM 事件
if (isLLMEvent(event)) {
  console.log('LLM event:', event.type); // 'llm.request' | 'llm.response' | ...
}

// 检查是否是终端事件
if (isTerminalEvent(event)) {
  // 终端事件表示流应该停止
  // 'done' | 'agent.error' | 'cancel'
}
```

## 事件流处理

使用 RxJS 操作符处理事件流：

```typescript
import { filter, map, tap } from 'rxjs/operators';

agent.run$('Hello').pipe(
  // 过滤特定事件类型
  filter(event => event.type === 'tool.result'),
  
  // 变换事件数据
  map(event => {
    if (event.type === 'tool.result') {
      return { toolName: event.toolName, result: event.result };
    }
    return null;
  }),
  
  // 记录日志
  tap(event => console.log('[Event]', event?.type))
).subscribe();
```

## 错误即事件

AgentForge 采用"错误即事件"模式，所有错误转换为事件而非 RxJS 错误通道：

```typescript
// 错误不会通过 subscriber.error() 传播
// 而是转换为 agent.error + done 事件
agent.run$('Hello').subscribe({
  next: (event) => {
    if (event.type === 'agent.error') {
      // 处理错误事件
      console.error('Error:', event.error.message);
    }
  },
  complete: () => {
    // 流正常完成（即使有错误）
    console.log('Stream completed');
  },
  // error: 永远不会被调用
});
```

## 自定义事件处理

使用 Agent 的 `on` 方法订阅特定事件：

```typescript
const agent = createAgent({ name: 'assistant', model: 'openai/gpt-4o' });

// 订阅特定事件类型
const unsubscribe = agent.on('llm.stream.text', (event) => {
  if (event.type === 'llm.stream.text') {
    process.stdout.write(event.delta);
  }
});

// 取消订阅
unsubscribe();
```

## 相关 API

- [AgentEvent API](/api/events) - 事件类型完整参考
- [状态管理](/guide/state) - AgentState 管理
- [操作符](/api/operators-control) - 事件流操作符