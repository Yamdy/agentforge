# 核心概念

理解 AgentForge 的核心概念是高效使用框架的基础。

## 事件驱动架构

AgentForge 的核心是 **命令式事件驱动架构**。Agent 的所有行为通过 `AgentEventEmitter` 分发事件，使用 `while(true)` 命令式循环驱动执行。

### 事件类型

AgentForge 定义了 18 种核心事件类型，分为三层：

```
Layer 1: 核心循环事件
├── agent.start      - Agent 启动
├── agent.step       - 步骤递增
├── agent.complete   - 正常完成
├── agent.error      - 错误发生
├── llm.request      - LLM 请求
├── llm.response     - LLM 响应
├── llm.stream.*     - 流式事件
├── tool.call        - 工具调用
├── tool.result      - 工具结果
└── done             - 流结束

Layer 2: 子系统事件
├── subagent.*       - 子 Agent 事件
├── mcp.*            - MCP 协议事件
├── workflow.*       - 工作流事件

Layer 3: 横切事件
├── checkpoint       - 检查点保存
└── cancel           - 取消执行
```

### 事件流示例

```
用户输入: "What is the weather in Tokyo?"
         │
         ▼
    agent.start ─────────────────────────────────
         │                                        │
         ▼                                        │
    agent.step (step: 1)                          │
         │                                        │
         ▼                                        │
    llm.request ──► LLM 决定调用工具               │
         │                                        │
         ▼                                        │
    llm.response (toolCalls: [{name: 'get_weather'}])
         │                                        │
         ▼                                        │
    tool.call (name: 'get_weather', args: {location: 'Tokyo'})
         │                                        │
         ▼                                        │
    tool.result (result: 'Sunny, 22°C')          │
         │                                        │
         ▼                                        │
    agent.step (step: 2)                          │
         │                                        │
         ▼                                        │
    llm.request ──► LLM 生成最终回答               │
         │                                        │
         ▼                                        │
    llm.response (content: 'The weather in Tokyo...')
         │                                        │
         ▼                                        │
    agent.complete ───────────────────────────────┘
         │
         ▼
    done (reason: 'stop')
```

### 订阅事件

```typescript
// agent.run() 返回 Promise<string>
// 使用 agent.on() 订阅事件
agent.on('llm.response', (event) => {
  console.log('LLM responded:', event.content);
});

agent.on('tool.call', (event) => {
  console.log('Calling tool:', event.toolName);
});

// 监听所有事件
agent.onAny((event) => console.log(event.type));

// 运行 Agent
const output = await agent.run('Hello!');
console.log(output);
```

## 状态管理

Agent 状态是不可变的，每次更新都返回新对象。

### AgentState 结构

```typescript
interface AgentState {
  // 标识
  sessionId: string;
  agentName: string;
  model: { provider: string; model: string };

  // 对话
  messages: Message[];
  
  // 执行状态
  step: number;
  maxSteps: number;
  
  // 输出
  output: string;
  
  // Token 统计
  tokens: { prompt: number; completion: number };
  
  // 待处理工具调用
  pendingToolCalls: ToolCall[];
  
  // 上下文管理
  contextManagement?: {
    totalTokens: number;
    compactionCount: number;
  };
}
```

### 状态更新

```typescript
import { updateState, appendMessage } from 'agentforge';

// 不可变更新
const newState = updateState(state, {
  step: state.step + 1,
});

// 追加消息
const stateWithMessage = appendMessage(state, {
  role: 'assistant',
  content: 'Hello!',
});
```

## 状态机

Agent 有 6 种状态：

```
                    ┌─────────┐
                    │ pending │
                    └────┬────┘
                         │ start()
                         ▼
                    ┌─────────┐
           ┌───────│ running │───────┐
           │       └────┬────┘       │
           │            │            │
     pause()     error/complete  cancel()
           │            │            │
           ▼            ▼            ▼
    ┌─────────┐  ┌───────────┐  ┌──────────┐
    │ paused  │  │ completed │  │ cancelled│
    └────┬────┘  │  error    │  └──────────┘
         │       └───────────┘
    resume()           ▲
         │             │
         └─────────────┘
```

### 状态检查

```typescript
import { AgentStateMachine } from 'agentforge';

const machine = new AgentStateMachine();

// 检查状态
console.log(machine.status); // 'pending'

// 检查是否可转换
if (machine.can('pause')) {
  machine.pause();
}
```

## 工具系统

### 工具定义

```typescript
import { z } from 'zod';

const tool = {
  name: 'search',
  description: 'Search the web',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().default(5),
  }),
  execute: async (args, ctx) => {
    // ctx 包含 sessionId, state, tools 等
    return `Results for: ${args.query}`;
  },
  
  // 可选：输出校验
  outputSchema: z.object({
    results: z.array(z.string()),
  }),
  
  // 可选：安全标记
  requiresApproval: false,
  riskLevel: 'low',
};
```

### 工具执行流程

```
llm.response (toolCalls)
       │
       ▼
  ┌────────────────┐
  │ ApprovalGate?  │  如果 requiresApproval=true
  └───────┬────────┘
          │
          ▼
  ┌────────────────┐
  │  tool.call     │
  └───────┬────────┘
          │
          ▼
  ┌────────────────┐
  │  execute()     │
  └───────┬────────┘
          │
          ▼
  ┌────────────────┐
  │ outputSchema?  │  校验输出
  └───────┬────────┘
          │
          ▼
  ┌────────────────┐
  │  tool.result   │
  └────────────────┘
```

## Checkpoint 恢复

AgentForge 支持 Checkpoint 机制，可以在任意步骤保存和恢复状态。

### 保存 Checkpoint

```typescript
import { createCheckpoint, CheckpointPosition } from 'agentforge';

const checkpoint = createCheckpoint({
  id: 'checkpoint-1',
  sessionId: 'session-123',
  position: 'after_llm',  // after_llm / after_tool
  state: currentState,
});
```

### 恢复执行

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  checkpoint: savedCheckpoint, // 从 Checkpoint 恢复
});

// 继续执行
const result = await agent.run('Continue from checkpoint');
```

## Hook 系统（插件架构）

Hook 系统通过三层切面替代了旧版的插件拦截模式：

| Hook 类型 | 用途 |
|-----------|------|
| `RequestHook` | 在 LLM 调用前修改消息列表 |
| `ToolHook` | 在工具执行前检查权限/阻断 |
| `LifecycleHook` | 在 Agent 生命周期关键点执行回调 |

### RequestHook 示例

```typescript
import type { RequestHook } from 'agentforge';

const systemPromptHook: RequestHook = {
  name: 'system-prompt',
  async beforeRequest(messages, ctx) {
    // 在每条 LLM 请求前注入 system prompt
    return [
      { role: 'system', content: 'You are a helpful assistant.' },
      ...messages,
    ];
  },
};

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  hooks: {
    request: [systemPromptHook],
  },
});
```

### LifecycleHook 示例

```typescript
import type { LifecycleHook } from 'agentforge';

const auditHook: LifecycleHook = {
  name: 'audit-logger',
  onSessionStart(ctx) {
    console.log(`Session started: ${ctx.sessionId}`);
  },
  onStepEnd(ctx) {
    console.log(`Step completed: ${ctx.state.step}`);
  },
};
```

### 通过事件订阅观察（不阻塞主流程）

```typescript
const agent = createAgent({ name: 'assistant', model: 'openai/gpt-4o' });

// 监听所有事件（纯观察，不阻塞）
agent.onAny((event) => {
  console.log(`[${event.type}]`, event);
});

// 订阅特定事件
agent.on('tool.result', (event) => {
  analytics.track('tool_executed', { name: event.toolName });
});
```

## 下一步

- [快速开始](/guide/getting-started) - 开始实践
- [API 参考](/api/) - 完整 API 文档
