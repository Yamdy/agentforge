# 核心 API

AgentForge 的核心 API 参考。

## Agent

### 构造函数

```typescript
new Agent(
  adapter: LLMAdapter,
  history: History,
  registry: ToolRegistry,
  options: AgentOptions
)
```

创建一个新的 Agent 实例。

### 参数

- `adapter` - LLM 适配器
- `history` - 历史记录存储
- `registry` - 工具注册中心
- `options` - Agent 配置选项

### AgentOptions

```typescript
interface AgentOptions {
  name: string; // Agent 名称
  maxSteps?: number; // 最大执行步数，默认 15
  temperature?: number; // 温度参数，默认 0.7
  systemPrompt?: string; // 系统提示词
  middleware?: Middleware[]; // 中间件列表
}
```

### 方法

#### run

```typescript
async run(message: string): Promise<string>
```

运行 Agent 并返回结果。

**示例：**

```typescript
const result = await agent.run('Hello, how are you?');
console.log(result);
```

#### runStream

```typescript
runStream(message: string): Observable<AgentEvent>
```

流式运行 Agent，返回 RxJS Observable。

**示例：**

```typescript
agent.runStream('Tell me a story').subscribe({
  next: (event) => {
    if (event.type === 'text') {
      process.stdout.write(event.content);
    }
  },
  complete: () => {
    console.log('\nDone!');
  },
});
```

#### pause

```typescript
async pause(): Promise<void>
```

暂停正在运行的 Agent。

#### resume

```typescript
async resume(): Promise<void>
```

恢复暂停的 Agent。

#### cancel

```typescript
async cancel(): Promise<void>
```

取消正在运行的 Agent。

### 属性

- `name` - Agent 名称
- `state` - 当前状态
- `adapter` - LLM 适配器
- `history` - 历史记录
- `registry` - 工具注册中心

### 事件

Agent 会发出以下事件：

- `state_change` - 状态改变
- `tool_call` - 工具调用
- `error` - 错误发生

**示例：**

```typescript
agent.on('state_change', (state) => {
  console.log('State changed:', state);
});

agent.on('tool_call', (toolCall) => {
  console.log('Tool called:', toolCall.tool.name);
});
```

## createAgent

```typescript
function createAgent(config: AgentConfig): Agent;
```

工厂函数，从配置创建 Agent。

**示例：**

```typescript
const agent = createAgent({
  agent: {
    name: 'My Agent',
    model: 'gpt-4o',
    maxSteps: 10,
  },
});
```

## AgentConfig

```typescript
interface AgentConfig {
  agent: {
    name: string;
    model?: string;
    maxSteps?: number;
    temperature?: number;
    tools?: string[];
    systemPrompt?: string;
  };
  model?: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  server?: {
    port?: number;
    host?: string;
  };
}
```

## AgentState

```typescript
enum AgentState {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}
```

## AgentEvent

```typescript
type AgentEvent = TextEvent | ToolCallStartEvent | ToolCallEndEvent | ErrorEvent | StateChangeEvent;

interface TextEvent {
  type: 'text';
  content: string;
}

interface ToolCallStartEvent {
  type: 'tool_call_start';
  name: string;
  args: Record<string, unknown>;
}

interface ToolCallEndEvent {
  type: 'tool_call_end';
  name: string;
  result: unknown;
}

interface ErrorEvent {
  type: 'error';
  error: Error;
}

interface StateChangeEvent {
  type: 'state_change';
  state: AgentState;
}
```

## 错误类型

### ToolExecutionError

```typescript
class ToolExecutionError extends Error {
  constructor(
    public toolName: string,
    message: string
  );
}
```

### APIError

```typescript
class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string
  );
}
```

### ValidationError

```typescript
class ValidationError extends Error {
  constructor(
    public field: string,
    message: string
  );
}
```

## 完整示例

```typescript
import { createAgent } from 'agentforge';

// 创建 Agent
const agent = createAgent({
  agent: {
    name: 'My Assistant',
    model: 'gpt-4o',
    maxSteps: 20,
    temperature: 0.3,
    tools: ['read', 'write', 'ls', 'bash'],
  },
});

// 监听事件
agent.on('state_change', (state) => {
  console.log('Agent state:', state);
});

agent.on('tool_call', (toolCall) => {
  console.log('Tool called:', toolCall.tool.name);
});

// 运行 Agent
const result = await agent.run('Help me with my project');
console.log(result);

// 流式运行
agent.runStream('Tell me a story').subscribe({
  next: (event) => {
    if (event.type === 'text') {
      process.stdout.write(event.content);
    }
  },
  complete: () => {
    console.log('\nStream completed');
  },
});
```

## 相关文档

- [配置 API](./config.md) - 配置系统 API
- [工具 API](./tools.md) - 工具系统 API
- [存储 API](./storage.md) - 存储系统 API
