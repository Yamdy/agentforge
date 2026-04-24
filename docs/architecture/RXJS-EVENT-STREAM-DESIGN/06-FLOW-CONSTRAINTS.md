# 流层陷阱与约束

> 这是框架稳定性的底线设计，任何实现都必须遵守。涵盖生命周期管理、异步竞态处理、错误边界设计等关键约束。

---

## 1. 生命周期与订阅泄漏（框架第一致命问题）

### 1.1 独立销毁链路

**原则**：所有 Agent 实例必须独立销毁链路，禁止全局共享无限订阅流。

```typescript
class Agent {
  // 每个 Agent 实例独立的销毁信号
  private destroy$ = new Subject<void>();
  
  run(input: string): Observable<AgentEvent> {
    return this.createEventFlow(input).pipe(
      takeUntil(this.destroy$),  // 所有内部流托管
    );
  }
  
  destroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

// 使用示例
const agent = createAgent(config);
const subscription = agent.run('task').subscribe();

// 外部销毁
agent.destroy();
// 或
subscription.unsubscribe();
```

### 1.2 暂停 vs 取消（严格区分）

| 操作 | 语义 | 实现 | 数据 |
|------|------|------|------|
| **暂停** | 阻断下一步，当前执行继续 | `isPaused` 标志 + `NEVER` | 不缓存，无内存问题 |
| **取消** | 立即终止，清理所有流 | `destroy$.next()` | 丢弃未完成数据 |
| **恢复** | 从断点继续 | `resume$.next()` | 从状态继续 |

**暂停的正确实现**：

在 Loop 决策点阻断，而不是用 `bufferToggle` 缓存事件。

```typescript
class Agent {
  private isPaused = false;
  private resume$ = new Subject<void>();
  
  // 暂停：阻断新的 LLM 请求
  pause(): void {
    this.isPaused = true;
  }
  
  // 恢复：允许继续
  resume(): void {
    this.isPaused = false;
    this.resume$.next();
  }
  
  private handleToolResult(event: AgentEvent, state: AgentState): Observable<AgentEvent> {
    // 更新状态...
    
    if (this.isPaused) {
      // 暂停时：不发起 LLM 请求，等待恢复
      // 当前 LLM 流自然完成，其结果已保存
      return NEVER;
    }
    
    // 检查步数限制
    if (state.step > state.maxSteps) {
      return of({ type: 'done', reason: 'length' });
    }
    
    // 继续循环：发起新的 LLM 请求
    return of({ type: 'llm.request', ... });
  }
}
```

**为什么不用 bufferToggle？**

```typescript
// ❌ 错误示例：bufferToggle 会缓存所有事件
bufferToggle(
  pause$,
  () => resume$,
)

// 问题：
// 1. 暂停期间内存持续增长
// 2. LLM 流式文本被缓存，恢复后一次性吐出（失去流式效果）
// 3. 长时间暂停会导致内存溢出
```

**暂停的关键设计**：

```
┌─────────────────────────────────────────────────────────────────────┐
│  暂停时机：在 tool.result → llm.request 之间                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ... → tool.result                                                   │
│           │                                                          │
│           ├─ 更新状态（messages, step）                              │
│           │                                                          │
│           └─ [检查 isPaused]                                        │
│                   │                                                  │
│                   ├─ [true]  → NEVER（等待 resume$）               │
│                   │              │                                   │
│                   │              └─ resume$.next() → llm.request   │
│                   │                                                  │
│                   └─ [false] → llm.request                          │
│                                                                      │
│  特点：                                                              │
│  ✅ 当前 LLM 流自然完成                                             │
│  ✅ 不缓存事件（无内存问题）                                         │
│  ✅ 恢复后从断点继续                                                │
│  ✅ 取消完全不同（destroy$）                                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 SubAgent 嵌套流约束

**原则**：子代理流必须挂载父级 `destroy$`，禁止孤儿流、游离订阅。

```typescript
private handleSubagentCall(event: AgentEvent, ctx: AgentContext): Observable<AgentEvent> {
  return ctx.subagents.run(event.toolName, event.args).pipe(
    // 继承父级销毁信号
    takeUntil(this.destroy$),
    
    // 也继承顶层 Context 的销毁信号（如果有）
    takeUntil(ctx.destroy$ ?? NEVER),
    
    // 标记来源
    map((e) => ({
      ...e,
      parentId: event.toolCallId,
      parentSessionId: ctx.sessionId,
    })),
  );
}
```

**嵌套流层级管理**：

```
顶层 Agent
  │
  ├─ destroy$ (Subject<void>)
  │
  └─ run() → Observable<AgentEvent>
        │
        ├─ handleToolCall (Subagent)
        │     │
        │     └─ subagent.run()
        │           │
        │           └─ takeUntil(parent.destroy$)  // 继承
        │
        └─ handleMCPToolCall
              │
              └─ mcp.callTool()
                    │
                    └─ takeUntil(parent.destroy$)  // 继承
```

---

## 2. 异步竞态与执行模型

### 2.1 映射算子选择（极易出错）

| 算子 | 并发模型 | 适用场景 | Agent Loop 中的用途 |
|------|---------|---------|---------------------|
| `expand` | 串行递归 | 一步完成后才展开下一步 | 主流程（隐含 concat） |
| `concatMap` | 串行 | 严格顺序执行 | 多 tool.call 串行 |
| `mergeMap` | 并行 | 多任务并发 | 并行工具调用、非关键打点 |
| `switchMap` | 作废旧请求 | 取消上一个 | 用户重新输入时取消旧 LLM |
| `exhaustMap` | 防重入 | 忽略新请求 | 防止重复触发 Loop |

**关键问题**：`expand` 已经定义了主流程顺序，但多个 `tool.call` 事件如何处理？

```typescript
// LLM 返回多个工具调用
llm.response → tool.call[A], tool.call[B], tool.call[C]

// 问题：A/B/C 是并行执行还是串行执行？
```

**两种策略的可配置设计**：

```typescript
interface AgentConfig {
  // ...
  parallelToolCalls?: boolean;  // 默认 false（串行）
}

private handleLLMResponse(event: AgentEvent): Observable<AgentEvent> {
  if (event.toolCalls?.length) {
    const toolCalls$ = from(event.toolCalls);
    
    if (this.config.parallelToolCalls) {
      // 并行执行（需状态保护）
      return toolCalls$.pipe(
        mergeMap((tc) => this.handleToolCall(tc), 4),  // 限制并发数
        toArray(),  // 等待全部完成
        // 汇总所有结果后继续
        concatMap(() => of({ type: 'llm.request', ... })),
      );
    } else {
      // 串行执行（更安全，默认）
      return toolCalls$.pipe(
        concatMap((tc) => this.handleToolCall(tc)),
      );
    }
  }
  
  // 无工具调用 → 完成
  return of({ type: 'agent.complete' }, { type: 'done' });
}
```

**并行执行的状态保护**：

```typescript
// 并行时状态更新的竞态问题
handleToolResult(result_A) → state = { ...state, messages: [...state.messages, result_A] }
handleToolResult(result_B) → state = { ...state, messages: [...state.messages, result_B] }

// 问题：state 更新会互相覆盖！
// 解决：用 scan 或状态锁
```

```typescript
// 方案 1: 使用 scan 累积状态
toolCalls$.pipe(
  mergeMap((tc) => this.handleToolCall(tc), 4),
  scan((state, event) => updateState(state, event), initialState),
  toArray(),
);

// 方案 2: 使用状态锁（mutex）
private stateLock = new AsyncLock();

private handleToolCall(event: AgentEvent): Observable<AgentEvent> {
  return defer(() => this.stateLock.acquire('state')).pipe(
    concatMap(() => this.executeToolAndUpdateState(event)),
    finalize(() => this.stateLock.release('state')),
  );
}
```

### 2.2 防重入锁（全局唯一执行）

**原则**：单 Agent 同一时间只允许一轮 Loop 执行，避免上下文错乱。

```typescript
class Agent {
  private running$ = new BehaviorSubject<boolean>(false);
  
  run(input: string): Observable<AgentEvent> {
    // 方式 1: 检查 + 抛错
    if (this.running$.value) {
      return throwError(() => new Error('Agent is already running'));
    }
    
    return this.running$.pipe(
      take(1),
      filter((running) => !running),
      tap(() => this.running$.next(true)),
      concatMap(() => this.createEventFlow(input)),
      finalize(() => this.running$.next(false)),
    );
  }
}

// 方式 2: 用 exhaustMap（更优雅）
class AgentRunner {
  private triggers$ = new Subject<string>();
  
  constructor(private agent: Agent) {
    this.triggers$.pipe(
      exhaustMap((input) => this.agent.run(input)),  // 自动丢弃新请求
    ).subscribe();
  }
  
  run(input: string): void {
    this.triggers$.next(input);
  }
}
```

---

## 3. 错误边界设计（框架稳定性底线）

### 3.1 错误分级

```typescript
enum ErrorSeverity {
  RECOVERABLE = 'recoverable',   // 单步错误，可重试/跳过
  FATAL = 'fatal',              // 致命错误，终止 Loop
}

enum ErrorCategory {
  LLM_TIMEOUT = 'llm_timeout',
  LLM_RATE_LIMIT = 'llm_rate_limit',
  LLM_SERVER_ERROR = 'llm_server_error',
  TOOL_EXECUTION = 'tool_execution',
  TOOL_VALIDATION = 'tool_validation',
  SCHEMA_VIOLATION = 'schema_violation',
  CONTEXT_CORRUPTED = 'context_corrupted',
  PERMISSION_DENIED = 'permission_denied',
}

// 错误分类器
function classifyError(error: Error): { severity: ErrorSeverity; category: ErrorCategory } {
  // LLM 相关
  if (error instanceof LLMTimeoutError) {
    return { severity: ErrorSeverity.RECOVERABLE, category: ErrorCategory.LLM_TIMEOUT };
  }
  if (error instanceof LLMRateLimitError) {
    return { severity: ErrorSeverity.RECOVERABLE, category: ErrorCategory.LLM_RATE_LIMIT };
  }
  if (error instanceof LLMServerError) {
    return { severity: ErrorSeverity.RECOVERABLE, category: ErrorCategory.LLM_SERVER_ERROR };
  }
  
  // Tool 相关
  if (error instanceof ToolExecutionError) {
    return { severity: ErrorSeverity.RECOVERABLE, category: ErrorCategory.TOOL_EXECUTION };
  }
  if (error instanceof ToolValidationError) {
    return { severity: ErrorSeverity.RECOVERABLE, category: ErrorCategory.TOOL_VALIDATION };
  }
  
  // 致命错误
  if (error instanceof SchemaValidationError) {
    return { severity: ErrorSeverity.FATAL, category: ErrorCategory.SCHEMA_VIOLATION };
  }
  if (error instanceof ContextCorruptedError) {
    return { severity: ErrorSeverity.FATAL, category: ErrorCategory.CONTEXT_CORRUPTED };
  }
  
  // 默认：可恢复
  return { severity: ErrorSeverity.RECOVERABLE, category: ErrorCategory.TOOL_EXECUTION };
}
```

### 3.2 错误处理策略

```typescript
private step(event: AgentEvent, state: AgentState, ctx: AgentContext): Observable<AgentEvent> {
  return this.handleEvent(event, state, ctx).pipe(
    catchError((error: Error) => {
      const { severity, category } = classifyError(error);
      
      // 错误透传：通知钩子 + 可观测
      ctx.onError?.(error, event, category);
      ctx.tracer?.recordException('current-span', error);
      ctx.metrics?.increment(`error.${category}`);
      
      if (severity === ErrorSeverity.RECOVERABLE) {
        // 可恢复错误：发出错误事件，继续 Loop
        return of({
          type: event.type.startsWith('llm') ? 'llm.error' : 'tool.error',
          timestamp: Date.now(),
          sessionId: ctx.sessionId,
          error,
          category,
          relatedEvent: event,
        });
      } else {
        // 致命错误：终止 Loop
        return concat(
          of({
            type: 'agent.error',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            error,
            category,
            fatal: true,
          }),
          of({
            type: 'done',
            timestamp: Date.now(),
            sessionId: ctx.sessionId,
            reason: 'error',
          }),
        );
      }
    }),
  );
}
```

### 3.3 禁止裸吞异常

```typescript
// ❌ 错误做法：吞掉异常，无法追踪
source$.pipe(
  catchError(() => EMPTY),  // 错误消失，无法排查
)

// ❌ 只打印，不透传
source$.pipe(
  catchError((e) => {
    console.error(e);  // 只在控制台看到
    return EMPTY;      // 错误事件流中消失
  }),
)

// ✅ 正确做法：透传给错误钩子 + 发出错误事件
source$.pipe(
  catchError((error) => {
    // 1. 通知错误钩子
    this.errorHandler?.onError(error);
    
    // 2. 记录到 tracer
    this.tracer?.recordException(error);
    
    // 3. 发出错误事件（可观测）
    return of({ type: 'error', error, recoverable: true });
  }),
)
```

### 3.4 重试策略解耦

```typescript
// src/operators/retry.ts

export interface RetryStrategy {
  /** 是否应该重试 */
  shouldRetry(error: Error, attempt: number, category: ErrorCategory): boolean;
  
  /** 计算延迟时间（毫秒） */
  getDelay(error: Error, attempt: number): number;
  
  /** 重试前的回调 */
  onRetry?(error: Error, attempt: number): void;
  
  /** 重试失败后的回调 */
  onFailed?(error: Error, totalAttempts: number): void;
}

// 指数退避策略
export class ExponentialBackoffRetry implements RetryStrategy {
  constructor(
    private initialDelay: number = 1000,
    private multiplier: number = 2,
    private maxDelay: number = 30000,
  ) {}
  
  shouldRetry(error: Error, attempt: number, category: ErrorCategory): boolean {
    // 分类决定是否重试
    if (category === ErrorCategory.PERMISSION_DENIED) return false;
    if (category === ErrorCategory.SCHEMA_VIOLATION) return false;
    if (category === ErrorCategory.CONTEXT_CORRUPTED) return false;
    return attempt < 5;
  }
  
  getDelay(error: Error, attempt: number): number {
    const delay = this.initialDelay * Math.pow(this.multiplier, attempt - 1);
    return Math.min(delay, this.maxDelay);
  }
  
  onRetry(error: Error, attempt: number): void {
    console.warn(`Retry attempt ${attempt}: ${error.message}`);
  }
}

// 操作符封装
export function retryWithStrategy(
  strategy: RetryStrategy,
  maxRetries: number = 3,
): OperatorFunction<AgentEvent, AgentEvent> {
  return retry({
    count: maxRetries,
    delay: (error, attempt) => {
      const { category } = classifyError(error);
      
      if (!strategy.shouldRetry(error, attempt, category)) {
        strategy.onFailed?.(error, attempt);
        throw error;
      }
      
      strategy.onRetry?.(error, attempt);
      return timer(strategy.getDelay(error, attempt));
    },
    resetOnSuccess: true,
  });
}

// 使用
agent.run(input).pipe(
  retryWithStrategy(new ExponentialBackoffRetry(1000, 2, 30000)),
)

// 或配置式
createAgent({
  retry: 3,
  retryStrategy: {
    type: 'exponential',
    initialDelay: 1000,
    multiplier: 2,
    maxDelay: 30000,
  },
})
```

### 3.5 Context 中的错误钩子

```typescript
export interface AgentContext {
  // ...
  
  /** 错误处理器 */
  onError?: (error: Error, event: AgentEvent, category: ErrorCategory) => void;
}

// 使用
const agent = createAgent({
  // ...
  onError: (error, event, category) => {
    // 发送到监控系统
    Sentry.captureException(error, {
      tags: { category, eventType: event.type },
    });
    
    // 写入日志
    logger.error('Agent error', { error, event, category });
    
    // 触发告警（致命错误）
    if (category === ErrorCategory.CONTEXT_CORRUPTED) {
      alerting.critical('Agent context corrupted', error);
    }
  },
});
```

---

## 4. 流层约束清单（实现必须遵守）

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **所有流托管 destroy$** | 内部 Observable 必须 `takeUntil(destroy$)` | 订阅泄漏，内存增长 |
| **暂停在决策点** | 仅阻断 `tool.result → llm.request` | 破坏流式效果，内存问题 |
| **嵌套流继承销毁** | SubAgent/MCP 必须继承父级 `destroy$` | 孤儿流，资源泄漏 |
| **默认串行工具调用** | `concatMap` 除非显式配置并行 | 状态竞态，上下文错乱 |
| **全局防重入** | 单 Agent 同时只执行一轮 Loop | 上下文混乱，结果错乱 |
| **错误必须透传** | 禁止 `catchError(() => EMPTY)` | 错误被吞，无法排查 |
| **重试策略解耦** | 策略注入，不硬编码 | 不可配置，僵化 |

---

## 5. 🔴 P1 新增：背压策略配置

> **问题**：当事件生产速度 > 消费速度时（如 LLM 流式输出快于工具执行），需要背压策略防止内存溢出或事件丢失。

### 5.1 背压场景

| 场景 | 生产者 | 消费者 | 风险 |
|------|--------|--------|------|
| LLM 流式输出 → 日志系统 | LLM (快) | 日志写入 (慢) | 日志积压，内存增长 |
| 并行工具调用 → 结果处理 | 多个工具 (并行) | Agent Loop (串行) | 结果积压 |
| A2A 消息接收 → 处理 | 远程 Agent (不可控) | 本地 Agent (有限) | 消息堆积 |
| SubAgent 事件 → 父 Agent | SubAgent (快) | 父 Agent (慢) | 事件积压 |

### 5.2 背压策略配置

```typescript
// src/core/config.ts

/**
 * 背压策略配置
 */
export const BackpressureConfigSchema = z.object({
  /** 策略类型 */
  strategy: z.enum(['buffer', 'drop', 'throttle', 'sample']).default('buffer'),
  
  /** 缓冲区大小（buffer 策略） */
  bufferSize: z.number().int().positive().default(100),
  
  /** 缓冲区满时的行为 */
  onBufferFull: z.enum(['drop_oldest', 'drop_newest', 'error', 'block']).default('drop_oldest'),
  
  /** 时间窗口（毫秒，throttle/sample 策略） */
  timeWindow: z.number().positive().default(1000),
  
  /** 是否发出背压事件 */
  emitBackpressureEvents: z.boolean().default(true),
});

export type BackpressureConfig = z.infer<typeof BackpressureConfigSchema>;

/**
 * AgentConfig 中的背压配置
 */
export const AgentConfigSchema = z.object({
  // ... 其他配置 ...
  
  // 🔴 P1 新增：背压配置
  backpressure: z.union([
    z.boolean(),  // true = 默认配置, false = 禁用
    BackpressureConfigSchema,
  ]).optional(),
});
```

### 5.3 背压操作符实现

```typescript
// src/operators/backpressure.ts

import { Observable, OperatorFunction } from 'rxjs';
import { bufferWithTimeOrCount, filter, tap, catchError, throwError } from 'rxjs/operators';

/**
 * 背压操作符：缓冲 + 溢出策略
 */
export function applyBackpressure<T>(
  config: BackpressureConfig
): OperatorFunction<T, T> {
  return (source) => {
    switch (config.strategy) {
      case 'buffer':
        return source.pipe(
          bufferWithTimeOrCount(
            config.timeWindow ?? Infinity,
            config.bufferSize
          ),
          // 展平缓冲
          mergeMap((items) => from(items)),
        );
        
      case 'drop':
        // 超过缓冲区时丢弃新事件
        let buffer: T[] = [];
        return source.pipe(
          tap((item) => {
            if (buffer.length < (config.bufferSize ?? 100)) {
              buffer.push(item);
            } else if (config.emitBackpressureEvents) {
              // 发出背压事件（可被外部观测）
              console.warn(`[Backpressure] Dropped event, buffer full: ${config.bufferSize}`);
            }
          }),
          filter(() => buffer.length > 0),
          map(() => buffer.shift()!),
        );
        
      case 'throttle':
        return source.pipe(
          throttleTime(config.timeWindow ?? 1000),
        );
        
      case 'sample':
        return source.pipe(
          sampleTime(config.timeWindow ?? 1000),
        );
        
      default:
        return source;
    }
  };
}

/**
 * 批量处理操作符：累积后批量发出
 * 
 * 用于：
 * - 日志批量写入
 * - 指标批量上报
 * - 消息批量发送
 */
export function batchEvents<T>(
  options: {
    maxBatchSize: number;
    maxWaitTime: number;  // 毫秒
  }
): OperatorFunction<T, T[]> {
  return (source) => source.pipe(
    bufferWithTimeOrCount(options.maxWaitTime, options.maxBatchSize),
    filter((batch) => batch.length > 0),
  );
}
```

### 5.4 使用示例

```typescript
// 配置背压
const agent = createAgent({
  name: 'my-agent',
  model: { provider: 'openai', model: 'gpt-4o' },
  backpressure: {
    strategy: 'buffer',
    bufferSize: 50,
    onBufferFull: 'drop_oldest',
    emitBackpressureEvents: true,
  },
});

// 批量处理日志
agent.run(input).pipe(
  filter((e) => e.type.startsWith('llm.stream')),
  batchEvents({ maxBatchSize: 20, maxWaitTime: 500 }),
  concatMap((events) => logger.batchWrite(events)),
).subscribe();
```

### 5.5 背压约束

| 约束 | 描述 |
|------|------|
| **默认启用缓冲** | 未配置时使用 buffer 策略，bufferSize=100 |
| **A2A 必配背压** | 跨 Agent 通信必须配置背压，防止消息堆积 |
| **监控缓冲使用** | 通过 Metrics 监控 `agent.backpressure.buffer_usage` |
| **禁止无限缓冲** | bufferSize 必须有上限，禁止 `Infinity`（开发环境除外） |

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [01-CORE-TYPES.md](./01-CORE-TYPES.md) - 核心类型定义
- [02-ZOD-CONTRACT.md](./02-ZOD-CONTRACT.md) - Zod 数据契约层
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [07-PLUGIN-SYSTEM.md](./07-PLUGIN-SYSTEM.md) - Hook + 插件系统
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
