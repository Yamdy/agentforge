# 插件系统

AgentForge 插件系统提供横切关注点的扩展能力。插件可以在不修改核心逻辑的情况下增强 Agent 行为。

## 设计原则

- **Hook = 横向切片增强**：通过操作符扩展事件流
- **DI = 纵向能力替换**：通过接口实现替换核心组件
- **拦截器用 concatMap**：阻塞主流程
- **观察器用 tap**：不阻塞主流程
- **异常隔离**：单个插件错误不影响主流程

## 插件类型

### Observer Plugin（观察器）

非阻塞、只读副作用的插件：

```typescript
import type { ObserverPlugin } from 'agentforge';

const loggingPlugin: ObserverPlugin = {
  name: 'logging',
  type: 'observer',
  priority: 10,
  eventTypes: [], // 空数组 = 订阅所有事件
  enabled: true,

  observe(event, ctx) {
    console.log(`[${event.type}]`, {
      sessionId: ctx.sessionId,
      agentName: ctx.agentName,
    });
  },
};
```

### Interceptor Plugin（拦截器）

阻塞主流程、可以修改事件的插件：

```typescript
import type { InterceptorPlugin } from 'agentforge';
import { of, EMPTY } from 'rxjs';

const permissionPlugin: InterceptorPlugin = {
  name: 'permission',
  type: 'interceptor',
  priority: 10,
  eventTypes: ['tool.call'], // 只拦截 tool.call 事件
  enabled: true,

  intercept(event, ctx) {
    if (event.type !== 'tool.call') {
      return of(event);
    }

    // 检查权限
    if (event.toolName === 'delete_file') {
      console.warn('Delete operation blocked');
      return EMPTY; // 阻止事件继续传播
    }

    return of(event); // 放行
  },
};
```

## 插件上下文

插件上下文是受限的，防止绕过 DI：

```typescript
interface PluginContext {
  // 只读标识
  readonly sessionId: string;
  readonly agentName: string;

  // 可观测性接口
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;

  // 注意：不提供 llm, tools, memory, checkpoint 等核心能力
  // 这些应该通过 DI 注入，而不是通过插件访问
}
```

## 插件管理器

使用 PluginManager 管理插件生命周期：

```typescript
import { PluginManager, createPluginContext } from 'agentforge';

const manager = new PluginManager();

// 设置上下文
manager.setContext(createPluginContext({
  sessionId: 'session-123',
  agentName: 'assistant',
}));

// 注册插件
manager.register(loggingPlugin);
manager.register(permissionPlugin);

// 启用/禁用插件
manager.disable('permission');
manager.enable('permission');

// 获取插件信息
manager.getAll(); // 所有插件
manager.getActivePlugins(); // 启用的插件
manager.getInterceptors(); // 拦截器
manager.getObservers(); // 观察器

// 注销插件
manager.unregister('logging');

// 清空所有插件
manager.clear();
```

## 构建插件管道

```typescript
import { buildPluginPipeline } from 'agentforge';

// 在 Agent 循环中使用
const source$ = agentLoop.run(input);

const pipeline$ = buildPluginPipeline(
  source$,
  manager.getActivePlugins(),
  pluginContext
);

pipeline$.subscribe(event => {
  // 处理经过插件管道的事件
});
```

## 内置插件

### Logging Plugin

生产级结构化日志插件：

```typescript
import { loggingPlugin } from 'agentforge/plugins';

// 输出格式：
// {"timestamp":"2024-01-15T10:30:00.000Z","sessionId":"...","agentName":"...","type":"agent.start","data":{...}}

manager.register(loggingPlugin);
```

### Metrics Plugin

指标收集插件：

```typescript
import { metricsPlugin } from 'agentforge/plugins';

// 收集的指标：
// - llm.tokens.prompt
// - llm.tokens.completion
// - tool.executions
// - agent.steps
// - agent.errors

manager.register(metricsPlugin);
```

## 自定义插件示例

### 限流插件

```typescript
const rateLimitPlugin: InterceptorPlugin = {
  name: 'rate-limit',
  type: 'interceptor',
  priority: 5, // 高优先级
  eventTypes: ['llm.request'],
  enabled: true,

  intercept(event, ctx) {
    if (event.type !== 'llm.request') {
      return of(event);
    }

    // 检查限流
    if (isRateLimited(ctx.sessionId)) {
      return of({
        type: 'agent.error',
        timestamp: Date.now(),
        sessionId: ctx.sessionId,
        error: {
          name: 'RateLimitError',
          message: 'Too many requests',
        },
      });
    }

    return of(event);
  },
};
```

### Webhook 通知插件

```typescript
const webhookPlugin: ObserverPlugin = {
  name: 'webhook',
  type: 'observer',
  priority: 100,
  eventTypes: ['agent.complete', 'agent.error'],
  enabled: true,

  async observe(event, ctx) {
    if (event.type === 'agent.complete' || event.type === 'agent.error') {
      // 异步发送 webhook，不阻塞主流程
      fetch('https://api.example.com/webhook', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: ctx.sessionId,
          event: event.type,
          timestamp: event.timestamp,
        }),
      }).catch(() => {
        // 静默失败
      });
    }
  },
};
```

## 执行顺序

插件按以下顺序执行：

```
Source Stream
    ↓
[Interceptor P=5] concatMap (优先级低先执行)
    ↓
[Interceptor P=10] concatMap
    ↓
[Observer P=10] tap
    ↓
[Observer P=20] tap
    ↓
Output Stream
```

## 相关 API

- [Plugin 接口](/api/#plugin-接口) - 插件类型定义
- [操作符](/api/operators-control) - 事件流操作符
- [预设](/api/presets) - 预设组合