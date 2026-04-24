# 操作符库

> 本文档定义 AgentForge 提供的 RxJS 操作符库，包括控制流、变换、通知和组合操作符。

---

## 1. 控制流操作符

```typescript
// src/operators/control.ts

import { Observable, OperatorFunction, throwError, timer } from 'rxjs';
import { retry, timeout, takeUntil, filter, catchError, mergeMap } from 'rxjs/operators';

// 重试（基于事件类型）
export function retryOnEventType(
  eventType: AgentEventType,
  count: number,
  delay: number = 1000
): OperatorFunction<AgentEvent, AgentEvent> {
  return (source) => source.pipe(
    retry({
      count,
      delay: (error, retryCount) => {
        // 只对特定事件类型的错误重试
        if (error.eventType === eventType) {
          return timer(delay * Math.pow(2, retryCount - 1));
        }
        return throwError(() => error);
      },
    }),
  );
}

// 超时（基于事件类型）
export function timeoutOnEventType(
  eventType: AgentEventType,
  ms: number
): OperatorFunction<AgentEvent, AgentEvent> {
  let startTime: number | null = null;
  
  return (source) => source.pipe(
    tap((event) => {
      if (event.type === eventType) {
        startTime = Date.now();
      }
    }),
    filter((event) => {
      if (startTime && Date.now() - startTime > ms) {
        throw new TimeoutError(eventType, ms);
      }
      return true;
    }),
  );
}

// 权限检查（可中断）
export function requirePermission(
  check: (event: AgentEvent) => boolean | Promise<boolean>
): OperatorFunction<AgentEvent, AgentEvent> {
  return mergeMap(async (event) => {
    if (event.type === 'tool.call') {
      const allowed = await check(event);
      if (!allowed) {
        throw new PermissionDeniedError(event.toolName, event.args);
      }
    }
    return event;
  });
}

// 步数限制
export function maxStepsLimit(max: number): OperatorFunction<AgentEvent, AgentEvent> {
  return filter((event) => {
    if (event.type === 'agent.step' && event.step > max) {
      throw new MaxStepsExceededError(max);
    }
    return true;
  });
}
```

---

## 2. 变换操作符

```typescript
// src/operators/transform.ts

// 修改 LLM 参数
export function transformLLMParams(
  transform: (params: { model: string; temperature?: number }) => typeof params
): OperatorFunction<AgentEvent, AgentEvent> {
  return map((event) => {
    if (event.type === 'llm.request') {
      const transformed = transform({ model: event.model.model, /* ... */ });
      return { ...event, model: { ...event.model, model: transformed.model } };
    }
    return event;
  });
}

// 修改工具参数
export function transformToolArgs(
  transform: (tool: string, args: Record<string, unknown>) => Record<string, unknown>
): OperatorFunction<AgentEvent, AgentEvent> {
  return map((event) => {
    if (event.type === 'tool.call') {
      return { ...event, args: transform(event.toolName, event.args) };
    }
    return event;
  });
}

// 消息压缩
export function compressMessages(
  shouldCompress: (messages: Message[]) => boolean,
  compress: (messages: Message[]) => Message[]
): OperatorFunction<AgentEvent, AgentEvent> {
  return map((event) => {
    if (event.type === 'llm.request' && shouldCompress(event.messages)) {
      return { ...event, messages: compress(event.messages) };
    }
    return event;
  });
}
```

---

## 3. 通知操作符

```typescript
// src/operators/notify.ts

// 日志
export function logEvents(
  logger: { debug: (msg: string, data?: unknown) => void } = console
): OperatorFunction<AgentEvent, AgentEvent> {
  return tap((event) => {
    logger.debug(`[${event.type}]`, event);
  });
}

// Tracing
export function traceEvents(
  tracer: Tracer
): OperatorFunction<AgentEvent, AgentEvent> {
  return tap((event) => {
    tracer.record(event);
  });
}

// Metrics
export function recordMetrics(
  metrics: Metrics
): OperatorFunction<AgentEvent, AgentEvent> {
  return tap((event) => {
    metrics.increment(`agent.event.${event.type}`);
    
    if (event.type === 'llm.response' && event.usage) {
      metrics.histogram('llm.tokens.prompt', event.usage.promptTokens);
      metrics.histogram('llm.tokens.completion', event.usage.completionTokens);
    }
    
    if (event.type === 'tool.result') {
      // metrics.histogram('tool.duration', ...);
    }
  });
}

// 远程导出（异步不阻塞）
export function exportEvents(
  exporter: (event: AgentEvent) => Promise<void>,
  onError: (error: Error) => void = () => {}
): OperatorFunction<AgentEvent, AgentEvent> {
  return tap((event) => {
    exporter(event).catch(onError);
  });
}

// 检查点
export function checkpoint(
  storage: CheckpointStorage,
  sessionId: string,
  shouldCheckpoint: (event: AgentEvent) => boolean
): OperatorFunction<AgentEvent, AgentEvent> {
  return tap(async (event) => {
    if (shouldCheckpoint(event)) {
      await storage.save({
        id: generateId(),
        sessionId,
        timestamp: Date.now(),
        position: 'after_llm', // 根据 event.type 决定
        state: {}, // 从上下文获取
      });
    }
  });
}
```

---

## 4. 组合操作符

```typescript
// src/operators/presets.ts

// 常用组合：生产环境
export function productionPreset(config: {
  timeout: number;
  maxRetries: number;
  tracer: Tracer;
  metrics: Metrics;
  checkpoint: CheckpointStorage;
}): OperatorFunction<AgentEvent, AgentEvent> {
  return (source) => source.pipe(
    timeout(config.timeout),
    retry(config.maxRetries),
    traceEvents(config.tracer),
    recordMetrics(config.metrics),
    // checkpoint(config.checkpoint, ...),
  );
}

// 常用组合：开发调试
export function debugPreset(
  logger: Console = console
): OperatorFunction<AgentEvent, AgentEvent> {
  return (source) => source.pipe(
    logEvents(logger),
    tap({
      error: (err) => logger.error('Agent error:', err),
      complete: () => logger.info('Agent completed'),
    }),
  );
}
```

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [12-API-DESIGN.md](./12-API-DESIGN.md) - API 设计
- [13-EXAMPLES.md](./13-EXAMPLES.md) - 使用示例
