# 记忆管理

AgentForge 记忆管理系统处理对话历史的存储和压缩，确保上下文窗口不会超限。

## 概述

长对话会消耗大量 token，超过模型的上下文窗口限制。记忆管理系统提供：

- **Token 估算**：预估消息的 token 数量
- **压缩策略**：多种压缩方法适应不同场景
- **自动触发**：达到阈值自动压缩
- **事件通知**：发出压缩事件供监控

## Token 估算

```typescript
import { estimateTokens } from 'agentforge';

const messages = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi! How can I help?' },
];

const tokenCount = estimateTokens(messages);
console.log('Estimated tokens:', tokenCount);
```

## 压缩策略

### Truncate Oldest（截断最旧）

最简单的策略，保留最近的 N 条消息：

```typescript
import { createTruncateCompactionManager } from 'agentforge';

const compactor = createTruncateCompactionManager(10); // 保留最近 10 条
```

### Summarize（摘要）

使用 LLM 总结旧消息：

```typescript
import { createSummarizeCompactionManager } from 'agentforge';

const compactor = createSummarizeCompactionManager(
  llmAdapter, // 用于生成摘要的 LLM
  10,         // 保留最近 10 条
  500         // 摘要最大长度
);
```

### Importance Weighted（重要性加权）

根据消息重要性选择保留：

```typescript
import { createCompactionManager } from 'agentforge';

const compactor = new CompactionManager({
  strategy: 'importance-weighted',
  preserveRecent: 10,
  targetTokenRatio: 0.5, // 压缩到上下文窗口的 50%
});
```

## 配置压缩管理器

```typescript
import { CompactionManager } from 'agentforge';

const compactor = new CompactionManager(
  {
    enabled: true,
    strategy: 'truncate-oldest',
    triggerThreshold: 0.8,    // 80% 时触发
    preserveRecent: 10,      // 保留最近 10 条
    maxSummaryLength: 500,   // 摘要最大长度
    targetTokenRatio: 0.5,   // 目标压缩比例
  },
  llmAdapter // 用于摘要策略
);
```

### 配置选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `enabled` | 是否启用压缩 | `true` |
| `triggerThreshold` | 触发阈值（占 maxTokens 百分比） | `0.8` |
| `strategy` | 压缩策略 | `'truncate-oldest'` |
| `preserveRecent` | 保留最近 N 条消息 | `10` |
| `maxSummaryLength` | 摘要最大长度 | `500` |
| `targetTokenRatio` | 目标 token 比例 | `0.5` |

## 检查是否需要压缩

```typescript
const context = compactor.createContext(
  'session-123',
  messages,
  4000 // maxTokens
);

if (compactor.needsCompaction(context)) {
  console.log('Compaction needed!');
}
```

## 执行压缩

```typescript
const result = await compactor.compact(context);

console.log('Tokens before:', result.tokensBefore);
console.log('Tokens after:', result.tokensAfter);
console.log('Messages removed:', result.removedCount);
console.log('Messages summarized:', result.summarizedCount);

// 使用压缩后的消息
const compactedMessages = result.messages;
```

## 自动压缩

使用 `compactIfNeeded` 方法自动检查并压缩：

```typescript
const result = await compactor.compactIfNeeded(
  'session-123',
  messages,
  4000
);

if (result) {
  console.log('Compaction performed');
  messages = result.messages;
} else {
  console.log('No compaction needed');
}
```

## 压缩事件

订阅压缩事件用于监控：

```typescript
compactor.events.subscribe(event => {
  if (event.type === 'compaction.start') {
    console.log('Starting compaction...');
    console.log('Strategy:', event.strategy);
    console.log('Tokens before:', event.tokensBefore);
  }
  
  if (event.type === 'compaction.complete') {
    console.log('Compaction complete');
    console.log('Tokens after:', event.tokensAfter);
    console.log('Removed:', event.removedMessages);
    console.log('Summarized:', event.summarizedMessages);
  }
});
```

## 在 Agent 中集成

将压缩管理器集成到 AgentContext：

```typescript
import { ContextBuilder } from 'agentforge';

const compactor = createCompactionManager(llmAdapter);

// 注意：当前版本需要手动在 Agent 循环外部处理
// 通过事件流触发压缩
agent.run$('Long conversation...').pipe(
  tap(event => {
    if (event.type === 'llm.request') {
      const context = compactor.createContext(
        event.sessionId,
        event.messages,
        4000
      );
      
      if (compactor.needsCompaction(context)) {
        // 触发压缩逻辑
      }
    }
  })
);
```

## 自定义压缩策略

```typescript
import type { CompactionResult } from 'agentforge';

function customStrategy(
  messages: Message[],
  preserveRecent: number
): CompactionResult {
  // 自定义逻辑
  const toKeep = messages.slice(-preserveRecent);
  const removed = messages.slice(0, -preserveRecent);
  
  return {
    messages: toKeep,
    tokensBefore: estimateTokens(messages),
    tokensAfter: estimateTokens(toKeep),
    removedCount: removed.length,
    strategy: 'custom',
  };
}
```

## 最佳实践

1. **合理设置阈值**：避免过于频繁的压缩
2. **保留足够上下文**：preserveRecent 应保留足够的最近消息
3. **监控压缩频率**：通过事件流监控压缩事件
4. **选择合适策略**：根据场景选择 truncate/summarize/importance-weighted

## 相关 API

- [CompactionManager](/api/compaction) - 压缩管理器 API
- [事件系统](/guide/events) - compaction.* 事件
- [配额控制](/guide/quota) - Token 配额管理