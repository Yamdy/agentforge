# AgentState API

AgentState 表示 Agent 在任意时刻的完整状态，用于状态机转换、检查点序列化和调试。

## 类型定义

```typescript
interface AgentState {
  // 身份标识
  sessionId: string;
  agentName: string;
  model: ModelConfig;

  // 对话历史
  messages: Message[];

  // 执行状态
  step: number;
  maxSteps: number;
  pendingToolCalls: ToolCall[];

  // 批处理上下文
  batchContext?: BatchContext;

  // 输出累积
  output: string;

  // Token 统计
  tokens: TokenStats;

  // 上下文管理
  contextManagement?: ContextManagement;
  lastCheckpoint?: CheckpointReference;
}
```

## 辅助类型

### ModelConfig

```typescript
interface ModelConfig {
  provider: string;
  model: string;
}
```

### TokenStats

```typescript
interface TokenStats {
  prompt: number;
  completion: number;
}
```

### BatchContext

```typescript
interface BatchContext {
  batchId: string;
  totalCalls: number;
  completedCalls: number;
  startedAt: number;
}
```

### ContextManagement

```typescript
interface ContextManagement {
  totalTokens: number;
  compactionCount: number;
  lastCompactionAt?: number;
}
```

### CheckpointReference

```typescript
interface CheckpointReference {
  id: string;
  timestamp: number;
  position: 'before_llm' | 'after_llm' | 'before_tool' | 'after_tool';
}
```

## 创建初始状态

```typescript
import { createInitialState } from 'agentforge';

const state = createInitialState({
  sessionId: 'session-123',
  agentName: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  maxSteps: 10,
  initialMessages: [
    { role: 'system', content: 'You are a helpful assistant.' },
  ],
});
```

## 不可变更新函数

### updateState

```typescript
function updateState(state: AgentState, update: Partial<AgentState>): AgentState;
```

创建新状态对象，验证结果符合 Schema。

### appendMessage

```typescript
function appendMessage(state: AgentState, message: Message): AgentState;
```

追加单条消息到对话历史。

### appendMessages

```typescript
function appendMessages(state: AgentState, messages: Message[]): AgentState;
```

追加多条消息到对话历史。

### incrementStep

```typescript
function incrementStep(state: AgentState): AgentState;
```

增加步骤计数器。

### isMaxStepsReached

```typescript
function isMaxStepsReached(state: AgentState): boolean;
```

检查是否达到最大步骤数。

### updateTokens

```typescript
function updateTokens(state: AgentState, promptTokens: number, completionTokens: number): AgentState;
```

更新 Token 统计。

### setPendingToolCalls

```typescript
function setPendingToolCalls(state: AgentState, toolCalls: ToolCall[]): AgentState;
```

设置待处理的工具调用。

### clearPendingToolCalls

```typescript
function clearPendingToolCalls(state: AgentState): AgentState;
```

清空待处理工具调用。

### setOutput

```typescript
function setOutput(state: AgentState, output: string): AgentState;
```

设置输出字符串。

## 上下文管理函数

### initContextManagement

```typescript
function initContextManagement(state: AgentState, totalTokens: number): AgentState;
```

初始化上下文管理状态。

### recordCompaction

```typescript
function recordCompaction(state: AgentState, tokensAfter: number): AgentState;
```

记录压缩事件后的状态。

## 批处理函数

### setBatchContext

```typescript
function setBatchContext(state: AgentState, batchContext: BatchContext): AgentState;
```

设置批处理上下文。

### clearBatchContext

```typescript
function clearBatchContext(state: AgentState): AgentState;
```

清空批处理上下文。

## 检查点函数

### updateLastCheckpoint

```typescript
function updateLastCheckpoint(state: AgentState, checkpoint: CheckpointReference): AgentState;
```

更新最近检查点引用。

## 使用示例

```typescript
import {
  createInitialState,
  appendMessage,
  incrementStep,
  updateTokens,
} from 'agentforge';

// 创建初始状态
let state = createInitialState({
  sessionId: 'session-123',
  agentName: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
});

// 追加消息
state = appendMessage(state, {
  role: 'user',
  content: 'Hello!',
});

// 增加步骤
state = incrementStep(state);

// 更新 Token
state = updateTokens(state, 100, 50);

console.log(state.step);     // 1
console.log(state.tokens);   // { prompt: 100, completion: 50 }
```

## 相关 API

- [事件系统](/api/events) - AgentEvent
- [检查点系统](/guide/memory) - 持久化与恢复