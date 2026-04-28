# 操作符库

> 本文档定义 AgentForge 提供的 RxJS 操作符库，包括控制流、变换、通知和组合操作符。
>
> **核心原则**：所有操作符遵循"错误即事件"模式 —— 错误转换为 `agent.error` 事件而非 RxJS 错误通道抛出。

---

## 1. 控制流操作符

```typescript
// src/operators/control.ts

import { Observable, defer, from } from 'rxjs';
import { tap, mergeMap, catchError } from 'rxjs/operators';

/**
 * 重试操作符（基于事件类型）
 *
 * 监听事件流中的错误事件（如 llm.error），当匹配指定类型且流完成时，
 * 自动重新订阅源流。使用指数退避延迟。
 *
 * 设计注意：由于 AgentForge 采用"错误即事件"架构，不能使用 RxJS 的
 * retry 操作符，必须手动监听错误事件并重新订阅。
 */
export function retryOnEventType(
  eventType: AgentEventType,
  count: number,
  delay: number = 1000
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    defer(() => {
      let retryCount = 0;

      return new Observable<AgentEvent>(subscriber => {
        let subscription = null;
        let hasMatchingError = false;

        const subscribe = () => {
          hasMatchingError = false;
          subscription = source.subscribe({
            next(event) {
              if (event.type === eventType) {
                hasMatchingError = true;
              }
              subscriber.next(event);
            },
            complete() {
              if (hasMatchingError && retryCount < count) {
                retryCount++;
                setTimeout(subscribe, delay * Math.pow(2, retryCount - 1));
              } else {
                subscriber.complete();
              }
            },
          });
        };

        subscribe();
        return () => subscription?.unsubscribe();
      });
    });
}

/**
 * 超时操作符（基于事件类型）
 *
 * 监听特定事件类型，如果在指定时间内未收到该事件，发射超时错误。
 */
export function timeoutOnEventType(
  eventType: AgentEventType,
  ms: number
): MonoTypeOperatorFunction<AgentEvent> {
  // 实现见 src/operators/control.ts
  // 使用自定义 Observable + setTimeout
}

/**
 * 权限检查操作符（可中断）
 *
 * 检查 tool.call 事件的权限。拒绝时发射 agent.error + done 事件，
 * 而非抛出 PermissionDeniedError。
 */
export function requirePermission(
  check: (event: AgentEvent) => boolean | Promise<boolean>
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    source.pipe(
      mergeMap(async event => {
        if (event.type !== 'tool.call') return [event];

        const allowed = await check(event);
        if (!allowed) {
          // 错误即事件：发射 agent.error + done，不抛出
          return [
            createErrorEvent(new Error('Permission denied'), sessionId),
            createDoneEvent(sessionId, 'error'),
          ];
        }
        return [event];
      }),
      mergeMap(events => from(events)),
    );
}

/**
 * 步数限制操作符
 *
 * 超过限制时发射 agent.error + done 事件（reason: 'length')。
 */
export function maxStepsLimit(max: number): MonoTypeOperatorFunction<AgentEvent> {
  // 实现见 src/operators/control.ts
}

/**
 * 暂停信号操作符
 *
 * 通过外部 Observable 控制流的暂停/恢复。
 */
export function pauseOnSignal(
  signal$: Observable<boolean>
): MonoTypeOperatorFunction<AgentEvent> {
  // 实现见 src/operators/control.ts
}
```

---

## 2. 变换操作符

```typescript
// src/operators/transform.ts

import { map } from 'rxjs/operators';

/**
 * 修改 LLM 参数
 *
 * 只处理 llm.request 事件，其他事件透传。
 */
export function transformLLMParams(
  transform: (params: LLMTransformParams) => Partial<LLMTransformParams>
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'llm.request') return event;

    const transformed = transform({
      model: event.model.model,
      provider: event.model.provider,
      // temperature, maxTokens 等
    });

    return {
      ...event,
      model: {
        provider: transformed.provider ?? event.model.provider,
        model: transformed.model ?? event.model.model,
      },
    };
  });
}

/**
 * 修改工具参数
 *
 * 只处理 tool.call 事件。
 */
export function transformToolArgs(
  transform: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'tool.call') return event;
    return { ...event, args: transform(event.toolName, event.args) };
  });
}

/**
 * 消息压缩
 *
 * 压缩 llm.request 事件中的消息数组以减少 token 使用。
 */
export function compressMessages(
  shouldCompress: (messages: Message[]) => boolean,
  compress: (messages: Message[]) => Message[]
): OperatorFunction<AgentEvent, AgentEvent> {
  return map(event => {
    if (event.type !== 'llm.request') return event;
    if (!shouldCompress(event.messages)) return event;
    return { ...event, messages: compress(event.messages) };
  });
}

/**
 * 注入系统提示
 *
 * 在 llm.request 事件的消息数组开头注入系统消息。
 */
export function injectSystemPrompt(
  prompt: string | ((messages: Message[]) => string)
): OperatorFunction<AgentEvent, AgentEvent> {
  // 实现见 src/operators/transform.ts
}
```

---

## 3. 通知操作符

> **设计原则**：所有通知操作符使用 `tap` 实现，永不阻塞主流程。
> 异步操作使用 fire-and-forget 模式，错误静默吞掉。

```typescript
// src/operators/notify.ts

import { tap } from 'rxjs/operators';

/**
 * 事件日志
 *
 * 使用 tap 记录所有事件，不阻塞流。
 */
export function logEvents(
  logger: Logger = console
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    logger.debug(`[${event.type}]`, event);
  });
}

/**
 * 分布式追踪
 *
 * 集成 OpenTelemetry、Jaeger 等追踪系统。
 */
export function traceEvents(
  tracer: Tracer
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    try {
      const spanId = tracer.startSpan(`agent.event.${event.type}`);
      tracer.endSpan(spanId);
    } catch {
      // 静默忽略追踪错误 - 永不中断流
    }
  });
}

/**
 * 指标采集
 *
 * 记录事件计数、token 使用量、工具执行等。
 */
export function recordMetrics(
  metrics: Metrics
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    try {
      metrics.increment(`agent.event.${event.type}`);
      if (event.type === 'llm.response' && event.usage) {
        metrics.histogram('llm.tokens.prompt', event.usage.promptTokens);
        metrics.histogram('llm.tokens.completion', event.usage.completionTokens);
      }
    } catch {
      // 静默忽略
    }
  });
}

/**
 * 远程导出（异步不阻塞）
 *
 * Fire-and-forget 模式：启动异步导出但不等待完成。
 */
export function exportEvents(
  exporter: (event: AgentEvent) => Promise<void>,
  onError: (error: Error) => void = () => {}
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    exporter(event).catch(onError);
  });
}

/**
 * 检查点保存
 *
 * 保存完整 agent 状态用于恢复。
 *
 * **重要**：`stateProvider` 参数是必需的，用于获取可恢复的真实状态。
 * 如果不提供，将使用占位状态（无法用于实际恢复）。
 *
 * @param storage - 检查点存储实现
 * @param sessionId - 会话标识符
 * @param shouldCheckpoint - 判断是否保存的谓词
 * @param stateProvider - 获取当前状态的函数（推荐提供）
 */
export function checkpoint(
  storage: CheckpointStorage,
  sessionId: string,
  shouldCheckpoint: (event: AgentEvent) => boolean,
  stateProvider?: () => AgentState | undefined
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    if (shouldCheckpoint(event)) {
      const state = stateProvider?.() ?? createPlaceholderState(sessionId);
      const checkpoint = createCheckpoint(sessionId, event, state);
      storage.save(checkpoint).catch(() => {});
    }
  });
}
```

---

## 4. 组合操作符（预设）

> 预设是常用操作符组合的便捷封装，返回单一 `MonoTypeOperatorFunction`。

```typescript
// src/operators/presets.ts

/**
 * 生产环境预设
 *
 * 组合：timeout + retry + traceEvents + recordMetrics + checkpoint
 */
export function productionPreset(config: {
  timeout: number;
  maxRetries: number;
  eventType: AgentEventType;  // 用于重试的错误事件类型
  tracer: Tracer;
  metrics: Metrics;
  checkpointStorage: CheckpointStorage;
  sessionId: string;
  stateProvider?: () => AgentState;
}): MonoTypeOperatorFunction<AgentEvent> {
  return source => source.pipe(
    timeoutOnEventType('llm.response', config.timeout),
    retryOnEventType(config.eventType, config.maxRetries),
    traceEvents(config.tracer),
    recordMetrics(config.metrics),
    checkpoint(
      config.checkpointStorage,
      config.sessionId,
      event => event.type === 'llm.response',
      config.stateProvider
    ),
  );
}

/**
 * 开发调试预设
 *
 * 组合：logEvents + 错误日志 + 完成日志
 */
export function debugPreset(
  logger: Logger = console
): MonoTypeOperatorFunction<AgentEvent> {
  return source => source.pipe(
    logEvents(logger),
    tap({
      complete: () => logger.info('Agent completed'),
    }),
  );
}

/**
 * 测试环境预设
 *
 * 提供钩子函数用于断言。
 */
export function testPreset(config?: {
  onEvent?: (event: AgentEvent) => void;
  onTerminal?: (event: AgentEvent) => void;
}): MonoTypeOperatorFunction<AgentEvent> {
  return source => source.pipe(
    tap(event => {
      config?.onEvent?.(event);
      if (event.type === 'done' || event.type === 'agent.error') {
        config?.onTerminal?.(event);
      }
    }),
  );
}

/**
 * 自定义预设工具函数
 */
export function createPreset(
  operators: MonoTypeOperatorFunction<AgentEvent>[]
): MonoTypeOperatorFunction<AgentEvent> {
  return source => operators.reduce((s, op) => s.pipe(op), source);
}
```

---

## 5. 设计决策记录

### 5.1 为什么 retryOnEventType 不使用 RxJS retry？

**原因**：AgentForge 采用"错误即事件"架构。错误（如 `llm.error`）是事件流中的普通事件，而非通过 RxJS 错误通道传递。RxJS 的 `retry` 操作符只能捕获 RxJS 错误通道的异常，无法感知事件流中的错误事件。

**解决方案**：使用自定义 Observable 监听错误事件，在流完成时检查是否需要重试。

### 5.2 为什么 checkpoint 需要 stateProvider？

**原因**：`tap` 操作符无法访问 `AgentState`。checkpoint 需要保存完整状态才能用于恢复。

**解决方案**：添加可选的 `stateProvider` 参数，由调用方传入状态获取函数。

```typescript
// 推荐用法
source.pipe(
  checkpoint(
    storage,
    sessionId,
    shouldCheckpoint,
    () => agentLoop.getState()  // 从 agent loop 获取真实状态
  )
)
```

### 5.3 为什么操作符发射 agent.error 而非 throw？

**原因**：RxJS 错误会中断整个流，导致后续事件丢失。AgentForge 要求所有错误都转换为事件，保证流稳定性。

**模式**：
```typescript
// ❌ 错误：抛出 RxJS 错误
throw new PermissionDeniedError(...)

// ✅ 正确：发射错误事件
return from([
  createErrorEvent(error, sessionId),
  createDoneEvent(sessionId, 'error'),
])
```

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [06-FLOW-CONSTRAINTS.md](./06-FLOW-CONSTRAINTS.md) - 流层陷阱与约束
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [12-API-DESIGN.md](./12-API-DESIGN.md) - API 设计
- [13-EXAMPLES.md](./13-EXAMPLES.md) - 使用示例
