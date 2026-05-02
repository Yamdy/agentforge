# API 参考

AgentForge 提供了完整的 TypeScript API。

## 核心 API

### createAgent

创建 Agent 实例的主入口。

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  // 必填
  name: string;
  model: {
    provider: string;
    model: string;
  };

  // 可选
  maxSteps?: number;           // 最大步数，默认 10
  tools?: ToolDefinition[];     // 工具列表
  llm?: LLMAdapter;            // 自定义 LLM 适配器
  checkpoint?: Checkpoint;     // 从 Checkpoint 恢复
  plugins?: Plugin[];          // 插件列表
  systemPrompt?: string;        // 系统提示词
  streaming?: boolean;         // 启用流式输出
});

// 返回
agent.run(input: string): Promise<string>;
agent.destroy(): void;
```

### AgentEvent

所有事件的联合类型。

```typescript
type AgentEvent =
  | AgentStartEvent
  | AgentStepEvent
  | AgentCompleteEvent
  | AgentErrorEvent
  | LLMRequestEvent
  | LLMResponseEvent
  | LLMStreamStartEvent
  | LLMStreamTextEvent
  | LLMStreamToolCallEvent
  | LLMStreamEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | HitlAskEvent
  | HitlAnswerEvent
  | CheckpointEvent
  | DoneEvent
  // ... 更多事件类型
  ;
```

### AgentState

Agent 状态结构。

```typescript
interface AgentState {
  sessionId: string;
  agentName: string;
  model: ModelConfig;
  messages: Message[];
  step: number;
  maxSteps: number;
  output: string;
  tokens: TokenStats;
  pendingToolCalls: ToolCall[];
  batchContext?: BatchContext;
  contextManagement?: ContextManagement;
  lastCheckpoint?: CheckpointReference;
}
```

## 接口定义

### LLMAdapter

LLM 适配器接口。

```typescript
interface LLMAdapter {
  readonly name: string;
  readonly provider: string;

  chat(
    messages: Message[], 
    options?: LLMOptions
  ): Promise<LLMResponse>;

  stream(
    messages: Message[], 
    options?: LLMOptions
  ): AsyncGenerator<LLMChunk>;

  formatTools?(tools: FunctionDefinition[]): unknown;
  normalizeMessages?(messages: Message[]): unknown[];
  formatToolChoice?(choice: ToolChoice): unknown;
}
```

### ToolDefinition

工具定义接口。

```typescript
interface ToolDefinition<TSchema = unknown> {
  name: string;
  description: string;
  parameters: TSchema;  // Zod schema
  execute: (
    args: unknown, 
    ctx?: ToolContext
  ) => Promise<string>;

  // 可选字段
  outputSchema?: unknown;      // 输出校验 schema
  requiresApproval?: boolean;  // 需要审批
  approvalMessage?: string;    // 审批提示
  sandboxRequired?: boolean;   // 需要沙箱
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}
```

### ToolRegistry

工具注册表接口。

```typescript
interface ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(name: string): boolean;
  get(name: string): ToolDefinition | undefined;
  has(name: string): boolean;
  list(): ToolDefinition[];
}
```

### CheckpointStorage

Checkpoint 存储接口。

```typescript
interface CheckpointStorage {
  save(checkpoint: Checkpoint): Promise<void>;
  load(sessionId: string): Promise<Checkpoint | null>;
  delete(sessionId: string): Promise<void>;
}
```

### HITLController

Human-in-the-loop 控制器接口。

```typescript
interface HITLController {
  ask(request: {
    askId: string;
    question: string;
    options?: string[];
  }): Promise<string>;

  answer(askId: string, answer: string): void;
  onAsk(callback: (request: AskRequest) => void): () => void;
}
```

## 插件接口

### InterceptorPlugin

拦截器插件接口。

```typescript
interface InterceptorPlugin extends Plugin {
  type: 'interceptor';
  
  intercept(
    event: AgentEvent, 
    ctx: PluginContext
  ): { continue: boolean; event?: AgentEvent };
}
```

### ObserverPlugin

观察者插件接口。

```typescript
interface ObserverPlugin extends Plugin {
  type: 'observer';
  
  observe(
    event: AgentEvent, 
    ctx: PluginContext
  ): void | Promise<void>;
}
```

### PluginContext

插件上下文（受限访问）。

```typescript
interface PluginContext {
  readonly sessionId: string;
  readonly agentName: string;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  
  // 注意：不提供 llm, tools, memory 等能力
  // 防止插件绕过 DI 约束
}
```

## Hook 系统

### RequestHook

```typescript
import type { RequestHook } from 'agentforge';

const systemPromptHook: RequestHook = {
  name: 'system-prompt',
  async beforeRequest(messages, state) {
    return [{ role: 'system', content: 'You are helpful.' }, ...messages];
  },
};
```

### ToolHook

```typescript
import type { ToolHook } from 'agentforge';

const permissionHook: ToolHook = {
  name: 'permission-check',
  async beforeExecute(toolCall, state) {
    if (toolCall.name === 'delete_file') {
      return { allowed: false, reason: 'Not permitted' };
    }
    return { allowed: true };
  },
};
```

### LifecycleHook

```typescript
import type { LifecycleHook } from 'agentforge';

const auditHook: LifecycleHook = {
  name: 'audit-log',
  async onSessionStart(ctx) {
    console.log(`Session: ${ctx.sessionId}`);
  },
  async onLLMResponse(ctx) {
    console.log(`Tokens: ${ctx.response.usage?.completionTokens}`);
  },
};
```

### Quickstart
```

## 工具函数

### 事件判断

```typescript
import {
  isTerminalEvent,     // 是否终端事件
  isLLMEvent,          // 是否 LLM 事件
  isToolEvent,         // 是否工具事件
  isSubagentEvent,     // 是否子 Agent 事件
  isMCPEvent,          // 是否 MCP 事件
} from 'agentforge/events';
```

### 状态操作

```typescript
import {
  updateState,          // 更新状态
  appendMessage,       // 追加消息
  incrementStep,       // 递增步数
  updateTokens,         // 更新 Token
  setPendingToolCalls, // 设置待处理工具
} from 'agentforge/state';
```

### Checkpoint 操作

```typescript
import {
  createCheckpoint,           // 创建检查点
  serializeCheckpoint,        // 序列化
  deserializeCheckpoint,      // 反序列化
  recordToolExecution,        // 记录工具执行
  isToolExecuted,             // 检查工具是否已执行
} from 'agentforge/checkpoint';
```

## 类型定义

### Message

```typescript
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  metadata?: MessageMetadata;
}
```

### ToolCall

```typescript
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
```

### LLMResponse

```typescript
interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}
```

### LLMChunk

```typescript
interface LLMChunk {
  text?: string;
  toolCallId?: string;
  toolName?: string;
  argsDelta?: string;
}
```

## 详细 API 文档

### Agent 创建

- [createAgent](/api/create-agent) - 创建 Agent 的主入口 API
- [Quickstart](/api/quickstart) - 零配置 API（Agent 类 + tool 函数）

### 核心类型

- [AgentEvent](/api/events) - 50+ 种事件类型完整参考
- [AgentState](/api/state) - Agent 状态管理 API
- [LLMAdapter](/api/llm-adapter) - LLM 适配器接口
- [ToolDefinition](/api/tool-definition) - 工具定义接口
- [Logger](/api/logger) - 结构化日志接口

### 扩展

- [Quickstart API](/api/quickstart) - 零配置快速开始
- [createAgent](/api/create-agent) - 配置式 Agent 创建
