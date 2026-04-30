# 事件系统

AgentForge 的核心架构基于 **命令式事件驱动**。所有操作通过 `AgentEventEmitter` 分发事件，使用 `while(true)` 循环驱动执行。

## 事件类型

AgentForge 定义了 18 种核心事件类型，分为三层：

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

## 事件订阅

使用 `agent.on()` 方法订阅特定事件，返回 unsubscribe 函数：

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({ name: 'assistant', model: 'openai/gpt-4o' });

// 订阅特定事件类型
const unsub1 = agent.on('tool.result', (event) => {
  console.log(`Tool: ${event.toolName}`, event.result);
});

// 订阅所有事件
const unsub2 = agent.onAny((event) => {
  console.log(`[${event.type}]`, event);
});

// 运行
const result = await agent.run('Hello');

// 取消订阅
unsub1();
unsub2();
```

## 错误即事件

AgentForge 采用"错误即事件"模式，所有错误转换为事件而非抛出异常：

```typescript
// 错误不会通过异常传播
// 而是转换为 agent.error + done 事件
agent.on('agent.error', (event) => {
  console.error('Error:', event.error.message);
});

agent.on('done', (event) => {
  console.log('Stream ended:', event.reason);
});

const result = await agent.run('Hello');
// 即使有错误，result 也会正常返回（可能为空字符串）
```

## 流式事件处理

```typescript
const agent = createAgent({
  name: 'streaming-agent',
  model: 'openai/gpt-4o',
  streaming: true,
});

// 监听流式文本
agent.on('llm.stream.text', (event) => {
  process.stdout.write(event.delta);
});

await agent.run('Write a story');
```

## 相关 API

- [AgentEvent API](/api/events) - 事件类型完整参考
- [状态管理](/guide/state) - AgentState 管理
- [创建 Agent](/api/create-agent) - Agent 配置 API