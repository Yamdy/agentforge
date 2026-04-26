# 核心概念

理解 AgentForge 的核心概念是高效使用框架的基础。

## 事件流

AgentForge 的核心是 **Observable 事件流**。Agent 的所有行为都通过事件表达。

### 事件类型

AgentForge 定义了 50+ 种事件类型，分为三层：

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
└── compaction.*     - 压缩事件

Layer 3: 横切事件
├── permission.*     - 权限事件
└── context.updated  - 上下文更新
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
import { filter, takeUntil } from 'rxjs/operators';
import { isTerminalEvent } from 'agentforge';

agent.run('Hello!').pipe(
  // 过滤特定事件
  filter((event) => event.type === 'llm.response'),
  
  // 在终端事件时完成
  takeUntilTerminal(),
).subscribe({
  next: (event) => console.log(event),
  complete: () => console.log('Done!'),
});
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
agent.run().subscribe(...);
```

## 插件架构

### 拦截器插件

拦截器可以修改或阻止事件：

```typescript
import type { InterceptorPlugin } from 'agentforge';
import { of } from 'rxjs';

const rateLimitPlugin: InterceptorPlugin = {
  name: 'rate-limiter',
  type: 'interceptor',
  priority: 20,
  eventTypes: ['llm.request'],
  enabled: true,
  
  intercept(event, ctx) {
    if (event.type === 'llm.request') {
      if (isRateLimited(ctx.sessionId)) {
        // 返回错误事件替代原事件
        return of({
          type: 'agent.error',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          error: { name: 'RateLimited', message: 'Too many requests' },
        });
      }
    }
    return of(event); // 放行原事件
  },
};
```

### 观察者插件

观察者只能读取事件，不能修改：

```typescript
import type { ObserverPlugin } from 'agentforge';

const analyticsPlugin: ObserverPlugin = {
  name: 'analytics',
  type: 'observer',
  priority: 100,
  eventTypes: [], // 空数组 = 所有事件
  enabled: true,
  
  observe(event, ctx) {
    // 发送到分析服务
    sendToAnalytics({
      sessionId: ctx.sessionId,
      eventType: event.type,
      timestamp: event.timestamp,
    });
  },
};
```

### 插件执行顺序

```
事件流 ───► PIIScrubberPlugin (priority: 10)
              │
              ▼
         ApprovalGatePlugin (priority: 15)
              │
              ▼
         RateLimitPlugin (priority: 20)
              │
              ▼
         [其他拦截器...]
              │
              ▼
         AuditLogPlugin (priority: 100)
              │
              ▼
         订阅者
```

## 下一步

- [快速开始](/guide/getting-started) - 开始实践
- [API 参考](/api/) - 完整 API 文档
