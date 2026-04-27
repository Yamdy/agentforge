# Logger API

AgentForge 提供结构化日志接口，替代直接使用 `console.*`。

## Logger 接口

```typescript
interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  error(msg: string, error?: Error, context?: Record<string, unknown>): void;
}
```

## 内置实现

### DefaultLogger

默认日志实现，带前缀和 sessionId：

```typescript
import { DefaultLogger } from 'agentforge';

const logger = new DefaultLogger('my-agent');
logger.info('Agent started', { sessionId: 'abc123' });
// 输出: [my-agent] Agent started { sessionId: 'abc123' }
```

### NoopLogger

空实现，丢弃所有日志：

```typescript
import { NoopLogger } from 'agentforge';

const logger = new NoopLogger();
logger.info('This is silently discarded');
```

## 使用方式

### 通过 AgentContext 注入

```typescript
import { createAgent, DefaultLogger } from 'agentforge';

const agent = createAgent({
  name: 'my-agent',
  model: { provider: 'openai', model: 'gpt-4o' },
  // Logger 会自动注入到 AgentContext
});

// Agent 内部的所有日志都会通过 Logger 输出
```

### 自定义 Logger

```typescript
import type { Logger } from 'agentforge';

class MyLogger implements Logger {
  debug(msg: string, ctx?: Record<string, unknown>) {
    // 发送到你的日志系统
    sendToLogSystem('debug', msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>) {
    sendToLogSystem('info', msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>) {
    sendToLogSystem('warn', msg, ctx);
  }
  error(msg: string, error?: Error, ctx?: Record<string, unknown>) {
    sendToLogSystem('error', msg, { ...ctx, error: error?.message });
  }
}
```

## 日志级别

| 级别 | 用途 |
|------|------|
| `debug` | 调试信息（工具引用、内部状态） |
| `info` | 一般信息（Agent 启动、步骤完成） |
| `warn` | 警告（配额检查失败、降级处理） |
| `error` | 错误（LLM 调用失败、工具执行异常） |

## 默认行为

- `AgentContext` 默认使用 `DefaultLogger`
- 所有 `console.*` 调用已替换为 `ctx.logger?.warn/error`
- 如果 `logger` 未设置，日志调用会被跳过（可选链 `?.`）
