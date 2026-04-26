# 状态管理

AgentForge 使用不可变状态模式管理 Agent 执行状态。状态通过事件流传递，永不直接修改。

## AgentState 结构

```typescript
interface AgentState {
  // 身份标识
  sessionId: string;
  agentName: string;
  model: { provider: string; model: string };

  // 对话历史
  messages: Message[];

  // 执行状态
  step: number;
  maxSteps: number;
  pendingToolCalls: ToolCall[];

  // 批处理上下文（并行工具执行）
  batchContext?: BatchContext;

  // 输出累积
  output: string;

  // Token 统计
  tokens: { prompt: number; completion: number };

  // 上下文管理
  contextManagement?: ContextManagement;
  lastCheckpoint?: CheckpointReference;
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

## 不可变更新

所有状态更新都返回新对象，原状态不变：

```typescript
import {
  updateState,
  appendMessage,
  incrementStep,
  updateTokens,
  setPendingToolCalls,
} from 'agentforge';

// 基础更新
const newState = updateState(state, { output: 'Hello!' });

// 追加消息
const withMessage = appendMessage(state, {
  role: 'user',
  content: 'Hi there!',
});

// 增加步骤
const nextStep = incrementStep(state);

// 更新 Token 统计
const withTokens = updateTokens(state, 100, 50);

// 设置待处理工具调用
const withTools = setPendingToolCalls(state, [
  { id: 'call-1', name: 'search', args: { query: 'test' } },
]);
```

## 状态机

Agent 状态机管理生命周期状态：

```
pending → [running]
running → [paused, completed, cancelled, error]
paused → [running, cancelled]
completed/cancelled/error → [] (终端状态)
```

```typescript
import { AgentStateMachine, isValidTransition } from 'agentforge';

const machine = new AgentStateMachine();

console.log(machine.state); // 'pending'

// 转换状态
machine.transition('running'); // true
console.log(machine.state); // 'running'

// 检查转换是否有效
isValidTransition('running', 'paused'); // true
isValidTransition('completed', 'running'); // false (终端状态)

// 检查是否是终端状态
machine.isTerminal(); // false

// 订阅状态变更
const unsubscribe = machine.onChange((from, to) => {
  console.log(`State changed: ${from} → ${to}`);
});
```

## 检查点与恢复

状态与检查点系统配合，支持暂停恢复：

```typescript
import { createCheckpoint, serializeCheckpoint, deserializeCheckpoint } from 'agentforge';

// 创建检查点
const checkpoint = createCheckpoint({
  id: 'cp-123',
  sessionId: state.sessionId,
  position: 'after_llm',
  state: state,
});

// 序列化
const json = serializeCheckpoint(checkpoint);

// 反序列化
const restored = deserializeCheckpoint(json);
```

## 状态在事件流中的传递

状态通过 `StepContext` 在事件处理中传递：

```typescript
// 内部实现模式
interface StepContext {
  event: AgentEvent;
  state: AgentState;
}

// expand 递归中状态传递
source$.pipe(
  expand(({ event, state }) => {
    // 处理事件，生成新状态
    const newState = processEvent(event, state);
    
    // 返回新的事件流和状态
    return getNextEvents(newState).pipe(
      map(event => ({ event, state: newState }))
    );
  })
);
```

## 上下文管理

对于长对话，状态支持上下文压缩：

```typescript
import { initContextManagement, recordCompaction } from 'agentforge';

// 初始化上下文管理
const withCtx = initContextManagement(state, 10000);

// 记录压缩事件
const afterCompaction = recordCompaction(withCtx, 5000);
```

## 相关 API

- [AgentState API](/api/state) - 完整类型参考
- [事件系统](/guide/events) - 事件类型说明
- [检查点系统](/guide/memory) - 持久化与恢复