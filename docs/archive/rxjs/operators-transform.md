# 变换操作符

变换操作符用于修改事件数据而不产生副作用。所有变换返回新对象（不可变）。

## transformLLMParams

修改 LLM 请求参数。

```typescript
function transformLLMParams(
  transform: (params: LLMTransformParams) => Partial<LLMTransformParams>
): OperatorFunction<AgentEvent, AgentEvent>;
```

### LLMTransformParams

```typescript
interface LLMTransformParams {
  model: string;
  provider: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
}
```

### 示例

```typescript
import { transformLLMParams } from 'agentforge/operators';

source$.pipe(
  // 降低温度以获得更确定性的响应
  transformLLMParams(params => ({
    ...params,
    temperature: 0.2
  }))
);

// 切换模型
source$.pipe(
  transformLLMParams(params => ({
    ...params,
    model: 'gpt-4-turbo'
  }))
);
```

---

## transformToolArgs

修改工具调用参数。

```typescript
function transformToolArgs(
  transform: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>
): OperatorFunction<AgentEvent, AgentEvent>;
```

### 示例

```typescript
import { transformToolArgs } from 'agentforge/operators';

// 添加默认参数
source$.pipe(
  transformToolArgs((name, args) => {
    if (name === 'search' && !args.limit) {
      return { ...args, limit: 10 };
    }
    return args;
  })
);

// 过滤空值
source$.pipe(
  transformToolArgs((name, args) => {
    return Object.fromEntries(
      Object.entries(args).filter(([, v]) => v != null)
    );
  })
);
```

---

## compressMessages

压缩对话历史消息。

```typescript
function compressMessages(
  shouldCompress: (messages: Message[]) => boolean,
  compress: (messages: Message[]) => Message[]
): OperatorFunction<AgentEvent, AgentEvent>;
```

### 示例

```typescript
import { compressMessages } from 'agentforge/operators';

// 保留最近 10 条消息
source$.pipe(
  compressMessages(
    messages => messages.length > 10,
    messages => messages.slice(-10)
  )
);

// 摘要旧消息
source$.pipe(
  compressMessages(
    messages => messages.length > 20,
    messages => [
      { role: 'system', content: 'Previous conversation summarized...' },
      ...messages.slice(-5)
    ]
  )
);
```

---

## injectSystemPrompt

注入或替换系统提示。

```typescript
function injectSystemPrompt(
  prompt: string | ((messages: Message[]) => string)
): OperatorFunction<AgentEvent, AgentEvent>;
```

### 示例

```typescript
import { injectSystemPrompt } from 'agentforge/operators';

// 静态系统提示
source$.pipe(
  injectSystemPrompt('You are a helpful assistant.')
);

// 动态系统提示
source$.pipe(
  injectSystemPrompt(messages => {
    const count = messages.filter(m => m.role === 'user').length;
    return `You have answered ${count} questions so far.`;
  })
);

// 扩展现有系统消息
source$.pipe(
  injectSystemPrompt(messages => {
    const existing = messages.find(m => m.role === 'system');
    return existing
      ? `${existing.content}\n\nAdditional instructions...`
      : 'Default system prompt';
  })
);
```

## 不变性保证

所有变换操作符遵循不可变原则：

```typescript
// 变换后的消息是新的数组
const original = event.messages;
const transformed$ = source$.pipe(
  compressMessages(m => m.length > 10, m => m.slice(-10))
);

transformed$.subscribe(event => {
  // event.messages 是新数组
  console.log(event.messages !== original); // true
});
```

## 相关 API

- [控制流操作符](/api/operators-control) - 流控制
- [通知操作符](/api/operators-notify) - 日志和指标
- [记忆管理](/guide/memory) - 上下文压缩