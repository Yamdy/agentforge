# 中间件

中间件允许你在 Agent 执行的不同阶段插入自定义逻辑。

## 中间件类型

### Before Tool Call - 工具调用前

```typescript
const beforeToolCallMiddleware: Middleware = {
  name: 'before-tool-call',
  async beforeToolCall(context) {
    console.log(`准备调用工具: ${context.tool.name}`);
    console.log('参数:', context.args);
  },
};
```

### After Tool Call - 工具调用后

```typescript
const afterToolCallMiddleware: Middleware = {
  name: 'after-tool-call',
  async afterToolCall(context) {
    console.log(`工具调用完成: ${context.tool.name}`);
    console.log('结果:', context.result);
  },
};
```

### Before Response - 响应前

```typescript
const beforeResponseMiddleware: Middleware = {
  name: 'before-response',
  async beforeResponse(context) {
    console.log('准备发送响应');
    console.log('响应内容:', context.response);
  },
};
```

### After Response - 响应后

```typescript
const afterResponseMiddleware: Middleware = {
  name: 'after-response',
  async afterResponse(context) {
    console.log('响应已发送');
  },
};
```

## 内置中间件

### Logger 中间件

```typescript
import { loggerMiddleware } from 'agentforge/middleware';

agent.use(loggerMiddleware);
```

### HITL 中间件（人工介入）

```typescript
import { hitlMiddleware } from 'agentforge/middleware';

agent.use(
  hitlMiddleware({
    tools: ['delete', 'write'], // 需要确认的工具
    prompt: '是否批准此操作？',
  })
);
```

### Todo 中间件

```typescript
import { todoMiddleware } from 'agentforge/middleware';

agent.use(todoMiddleware());
```

## 创建自定义中间件

### 基本结构

```typescript
import { Middleware } from 'agentforge/types';

const myMiddleware: Middleware = {
  name: 'my-middleware',
  async beforeToolCall(context) {
    // 工具调用前逻辑
  },
  async afterToolCall(context) {
    // 工具调用后逻辑
  },
  async beforeResponse(context) {
    // 响应前逻辑
  },
  async afterResponse(context) {
    // 响应后逻辑
  },
};
```

### 使用中间件

```typescript
agent.use(myMiddleware);
```

## 中间件示例

### 性能监控

```typescript
const performanceMiddleware: Middleware = {
  name: 'performance',
  async beforeToolCall(context) {
    context.startTime = Date.now();
  },
  async afterToolCall(context) {
    const duration = Date.now() - context.startTime;
    console.log(`工具 ${context.tool.name} 耗时: ${duration}ms`);
  },
};
```

### 参数验证

```typescript
const validationMiddleware: Middleware = {
  name: 'validation',
  async beforeToolCall(context) {
    if (context.tool.name === 'delete' && !context.args.confirm) {
      throw new Error('删除操作需要确认');
    }
  },
};
```

### 结果缓存

```typescript
const cache = new Map();

const cacheMiddleware: Middleware = {
  name: 'cache',
  async beforeToolCall(context) {
    const key = JSON.stringify({ tool: context.tool.name, args: context.args });
    if (cache.has(key)) {
      context.cached = true;
      context.result = cache.get(key);
    }
  },
  async afterToolCall(context) {
    if (!context.cached) {
      const key = JSON.stringify({ tool: context.tool.name, args: context.args });
      cache.set(key, context.result);
    }
  },
};
```

### 错误处理

```typescript
const errorHandlerMiddleware: Middleware = {
  name: 'error-handler',
  async afterToolCall(context) {
    if (context.error) {
      console.error('工具执行错误:', context.error);
      // 可以在这里进行错误恢复
      context.result = { error: context.error.message, success: false };
    }
  },
};
```

### 审计日志

```typescript
const auditMiddleware: Middleware = {
  name: 'audit',
  async beforeToolCall(context) {
    await auditLog.log({
      action: 'tool_call',
      tool: context.tool.name,
      args: context.args,
      timestamp: new Date(),
    });
  },
};
```

### 重试逻辑

```typescript
const retryMiddleware: Middleware = {
  name: 'retry',
  async beforeToolCall(context) {
    context.retryCount = context.retryCount || 0;
  },
  async afterToolCall(context) {
    if (context.error && context.retryCount < 3) {
      context.retryCount++;
      console.log(`重试 ${context.tool.name} (${context.retryCount}/3)`);
      // 重新执行工具
      return context.tool.execute(context.args);
    }
  },
};
```

## 中间件链

中间件按注册顺序执行：

```typescript
agent.use(loggerMiddleware);
agent.use(performanceMiddleware);
agent.use(cacheMiddleware);
agent.use(errorHandlerMiddleware);

// 执行顺序: logger -> performance -> cache -> errorHandler
```

## 条件中间件

```typescript
const conditionalMiddleware: Middleware = {
  name: 'conditional',
  async beforeToolCall(context) {
    // 只对特定工具生效
    if (context.tool.name === 'sensitive_tool') {
      console.log('敏感工具调用');
    }
  },
};
```

## 异步中间件

```typescript
const asyncMiddleware: Middleware = {
  name: 'async',
  async beforeToolCall(context) {
    // 异步操作
    await someAsyncOperation();
    context.enrichedData = await fetchEnrichedData();
  },
};
```

## 移除中间件

```typescript
agent.unuse('my-middleware');
```

## 完整示例

```typescript
import { createAgent } from 'agentforge';
import { Middleware } from 'agentforge/types';

// 创建多个中间件
const loggerMiddleware: Middleware = {
  name: 'logger',
  async beforeToolCall(context) {
    console.log(`[START] ${context.tool.name}`);
  },
  async afterToolCall(context) {
    console.log(`[END] ${context.tool.name}`);
  },
};

const authMiddleware: Middleware = {
  name: 'auth',
  async beforeToolCall(context) {
    if (!context.user?.isAdmin && context.tool.name === 'admin_tool') {
      throw new Error('需要管理员权限');
    }
  },
};

const cacheMiddleware: Middleware = {
  name: 'cache',
  async beforeToolCall(context) {
    const key = JSON.stringify(context.args);
    if (cache.has(key)) {
      context.result = cache.get(key);
      context.cached = true;
    }
  },
  async afterToolCall(context) {
    if (!context.cached) {
      const key = JSON.stringify(context.args);
      cache.set(key, context.result);
    }
  },
};

// 创建 Agent 并添加中间件
const agent = createAgent(config);
agent.use(loggerMiddleware);
agent.use(authMiddleware);
agent.use(cacheMiddleware);

// 运行 Agent
const result = await agent.run('执行一些操作');
```

## 下一步

- [权限管理](./permissions.md) - 了解权限系统
- [流式响应](./streaming.md) - 深入了解流式响应
