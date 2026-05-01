# AgentEvent API

AgentEvent 是 AgentForge 事件流的核心类型，所有事件使用 Zod Schema 定义。

## 类型定义

```typescript
type AgentEvent = z.infer<typeof AgentEventSchema>;

// Discriminated Union，通过 type 字段区分
const AgentEventSchema = z.discriminatedUnion('type', [...]);
```

## 核心事件类型

### Agent 生命周期事件

#### agent.start

```typescript
interface AgentStartEvent {
  type: 'agent.start';
  timestamp: number;
  sessionId: string;
  input: string;
  agentName: string;
  model: { provider: string; model: string };
}
```

#### agent.step

```typescript
interface AgentStepEvent {
  type: 'agent.step';
  timestamp: number;
  sessionId: string;
  step: number;
  maxSteps: number;
}
```

#### agent.complete

```typescript
interface AgentCompleteEvent {
  type: 'agent.complete';
  timestamp: number;
  sessionId: string;
  output: string;
  steps: number;
  tokens?: { input: number; output: number };
}
```

#### agent.error

```typescript
interface AgentErrorEvent {
  type: 'agent.error';
  timestamp: number;
  sessionId: string;
  error: SerializedError;
  step?: number;
}
```

### LLM 事件

#### llm.request

```typescript
interface LLMRequestEvent {
  type: 'llm.request';
  timestamp: number;
  sessionId: string;
  messages: Message[];
  model: { provider: string; model: string };
  tools?: string[];
}
```

#### llm.response

```typescript
interface LLMResponseEvent {
  type: 'llm.response';
  timestamp: number;
  sessionId: string;
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
  usage?: { promptTokens: number; completionTokens: number };
}
```

#### llm.stream.text

```typescript
interface LLMStreamTextEvent {
  type: 'llm.stream.text';
  timestamp: number;
  sessionId: string;
  delta: string;
}
```

#### llm.error

```typescript
interface LLMErrorEvent {
  type: 'llm.error';
  timestamp: number;
  sessionId: string;
  error: SerializedError;
}
```

### 工具事件

#### tool.call

```typescript
interface ToolCallEvent {
  type: 'tool.call';
  timestamp: number;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}
```

#### tool.execute

```typescript
interface ToolExecuteEvent {
  type: 'tool.execute';
  timestamp: number;
  sessionId: string;
  toolCallId: string;
  toolName: string;
}
```

#### tool.result

```typescript
interface ToolResultEvent {
  type: 'tool.result';
  timestamp: number;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  isError: boolean;
}
```

### 控制事件

#### done

```typescript
interface DoneEvent {
  type: 'done';
  timestamp: number;
  sessionId: string;
  reason: 'stop' | 'tool_calls' | 'length' | 'error' | 'cancelled';
}
```

#### cancel

```typescript
interface CancelEvent {
  type: 'cancel';
  timestamp: number;
  sessionId: string;
  reason?: string;
}
```

### HITL 事件

#### hitl.ask

```typescript
interface HITLAskEvent {
  type: 'hitl.ask';
  timestamp: number;
  sessionId: string;
  askId: string;
  question: string;
  toolCallId: string;
  toolName: string;
  options?: string[];
  metadata?: Record<string, unknown>;
}
```

#### hitl.answer

```typescript
interface HITLAnswerEvent {
  type: 'hitl.answer';
  timestamp: number;
  sessionId: string;
  askId: string;
  answer: string;
  toolCallId: string;
  toolName: string;
}
```

## 类型守卫

```typescript
import {
  isAgentEvent,
  isLLMEvent,
  isToolEvent,
  isHITLEvent,
  isTerminalEvent,
  isAgentLifecycleEvent,
  isSubagentEvent,
  isMCPEvent,
  isWorkflowEvent,
} from 'agentforge';

// 检查事件类型
if (isLLMEvent(event)) {
  // event 类型收窄为 LLM 事件
}

if (isTerminalEvent(event)) {
  // 'done' | 'agent.error' | 'cancel'
}
```

## 辅助函数

### serializeError

```typescript
function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
  };
}
```

### generateId

```typescript
function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}

// 示例
generateId();          // "lkj3m2n-random123"
generateId('session'); // "session-lkj3m2n-random123"
```

## 相关 API

- [状态管理](/api/state) - AgentState
- [事件系统指南](/guide/events) - 事件使用说明