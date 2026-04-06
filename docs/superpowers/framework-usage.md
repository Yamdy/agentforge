# Primo Agent 框架使用文档

## 快速开始

```typescript
import { Agent, InMemoryHistory, ToolRegistry, AIAdapter } from 'primo-agent';

const adapter = new AIAdapter({ model: 'gpt-4-turbo', apiKey: 'xxx' });
const registry = new ToolRegistry();
registry.register(myTool);
adapter.setTools(registry.list());

const agent = new Agent(adapter, new InMemoryHistory(), registry);
const result = await agent.run('Your prompt');
```

## 配置验证

```typescript
import { validateServerConfig, validateAgentConfig } from 'primo-agent';

const serverConfig = validateServerConfig({ port: 3000 });
const agentConfig = validateAgentConfig({ model: 'gpt-4' });
```

## 错误处理

```typescript
import { AppError, NotFoundError, ToolExecuteError } from 'primo-agent';

try {
  await agent.run('prompt');
} catch (err) {
  if (err instanceof NotFoundError) {
    // 处理未找到
  } else if (err instanceof ToolExecuteError) {
    // 工具执行失败
  }
}
```

## Schema 使用

```typescript
import { schemas, MessageSchema } from 'primo-agent';

const validMessage = MessageSchema.parse({ role: 'user', content: 'Hello' });
// 或使用 schemas 对象
const toolSchema = schemas.Tool;
```

## 重试机制

```typescript
import { withRetry } from 'primo-agent';

const result = await withRetry(() => someOperation(), { maxAttempts: 3, delayMs: 1000 });
```

## 工具缓存

```typescript
import { toolCache } from 'primo-agent';

// 手动设置缓存
toolCache.set('key', value, 60000);

// 获取缓存
const value = toolCache.get<string>('key');
```

## 中间件

Server 已内置以下中间件:

- `errorMiddleware` - 全局错误处理
- `loggingMiddleware` - 请求日志
- `rateLimitMiddleware` - 速率限制

详细使用见 architecture.md
