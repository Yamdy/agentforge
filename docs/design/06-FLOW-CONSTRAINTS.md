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
| **🔴 P0 新增：Subscription Safety** | 状态化 operator 必须用 `defer()` 包裹，确保每次订阅有独立状态 | 多订阅共享状态导致数据污染、事件丢失、竞态条件 |

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
        // 🔴 P0 修复：使用 defer() 确保每次订阅有独立 buffer
        // 超过缓冲区时丢弃新事件
        return defer(() => {
          const buffer: T[] = [];
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
        });
        
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
| **🔴 P0 新增：状态隔离** | 所有状态化 operator（drop策略、buffer等）必须用 `defer()` 包裹，确保订阅独立状态 |

---

## 6. 性能约束（P0 新增）

> 基于代码审计发现的性能问题，新增以下约束。

### 6.1 算法复杂度约束

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **禁止 O(n²) 在热路径** | 内存压缩、消息处理等高频操作必须 O(n log n) 或更好 | 大上下文时性能急剧下降 |
| **禁止 indexOf 在循环** | 使用 Map/Set 替代 O(n) 查找 | 1000条消息 = 百万次比较 |
| **Object spread 适度使用** | 热路径避免频繁 `{ ...state }` | 每次 expand 创建新对象 |

**已修复问题**:
- `memory/strategies.ts` importanceWeighted(): 从 O(n²) 优化为 O(n)

### 6.2 异步并行化约束

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **禁止 await 在 for-of** | 独立操作用 `Promise.all` 并行化 | N 个操作 = Nx 延迟 |
| **文件 IO 并行化** | 多文件读取使用 `Promise.all` | 加载速度慢 |

**已修复问题**:
- `skill/loader.ts`: 技能加载并行化

### 6.3 资源清理约束

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **Timer 必须存储引用** | setTimeout 返回值存储在类属性 | close() 后仍触发回调 |
| **无界缓冲区禁止** | 操作符缓冲必须有 maxBufferSize | 长时间暂停内存耗尽 |
| **Controller 必须有 destroy()** | 状态化组件必须提供清理方法 | Agent 频繁创建销毁时泄漏 |

**已修复问题**:
- `operators/control.ts` pauseOnSignal: 添加 maxBufferSize 选项
- `core/context.ts` DefaultHITLController: 添加 destroy() 方法
- `mcp/http-transport.ts`: 存储 reconnect timer 引用

### 6.4 性能约束清单

```typescript
// ✅ 正确：O(n) 收集保持顺序
const compacted: Message[] = [];
for (let i = 0; i < messages.length; i++) {
  if (selectedIndices.has(i)) {
    compacted.push(messages[i]!);
  }
}

// ❌ 错误：O(n²) indexOf 在 sort
messages.filter(...).sort((a, b) => {
  const aIdx = messages.indexOf(a);  // O(n) 每次调用
  return aIdx - messages.indexOf(b);
});

// ✅ 正确：并行加载
const results = await Promise.all(
  entries.map(entry => loadSkill(entry.path))
);

// ❌ 错误：顺序加载
for (const entry of entries) {
  await loadSkill(entry.path);  // 串行 = Nx 延迟
}

// ✅ 正确：Timer 存储引用
this._reconnectTimer = setTimeout(() => {...}, delay);
// 在 close() 中清理
if (this._reconnectTimer) clearTimeout(this._reconnectTimer);

// ❌ 错误：Timer 未存储
setTimeout(() => this.reconnect(), delay);  // 无法取消
```

---

## 7. 配额管控约束 (P0)

> 成本管控是生产环境必备能力，在 LLM 调用前检查配额，避免超额消耗。

### 7.1 配额控制器接口

```typescript
// src/quota/quota-controller.ts

/** 配额使用量 */
export interface QuotaUsage {
  promptTokens: number;
  completionTokens: number;
  totalCost?: number;  // 可选: 美元成本
}

/** 配额限制 */
export interface QuotaLimits {
  maxPromptTokens: number;
  maxCompletionTokens: number;
  maxTotalCost?: number;
}

/** 配额检查结果 */
export interface QuotaCheckResult {
  allowed: boolean;
  remaining: QuotaUsage;
  projectedUsage: QuotaUsage;
}

/** 配额控制器接口 */
export interface QuotaController {
  /** 检查是否有足够配额 */
  check(sessionId: string, projected: QuotaUsage): Promise<QuotaCheckResult>;
  
  /** 消费配额 */
  consume(sessionId: string, usage: QuotaUsage): Promise<void>;
  
  /** 获取当前使用量 */
  getUsage(sessionId: string): Promise<QuotaUsage>;
  
  /** 获取限额配置 */
  getLimits(): QuotaLimits;
  
  /** 配额耗尽事件流 */
  onExhausted(): Observable<QuotaExhaustedEvent>;
  
  /** 重置会话使用量 */
  reset(sessionId: string): void;
}

/** 配额耗尽事件 */
export interface QuotaExhaustedEvent {
  type: 'quota.exhausted';
  sessionId: string;
  reason: 'tokens' | 'cost';
  usage: QuotaUsage;
  limits: QuotaLimits;
}
```

### 7.2 AgentContext 集成

```typescript
// 扩展 AgentContext 接口
declare module '../core/context.js' {
  interface AgentContext {
    /** 配额控制器 (可选) */
    quota?: QuotaController;
  }
}
```

### 7.3 集成位置

```typescript
// src/loop/agent-loop.ts 修改

function handleLLMRequest(state: AgentState): Observable<StepContext> {
  // 配额预检查
  if (ctx.quota) {
    const projectedTokens = estimatePromptTokens(state.messages);
    
    return from(ctx.quota.check(sessionId, {
      promptTokens: projectedTokens,
      completionTokens: 0,
    })).pipe(
      mergeMap(result => {
        if (!result.allowed) {
          // 配额耗尽 → agent.error + done (符合错误即事件铁律)
          return from([
            { event: {
              type: 'agent.error',
              timestamp: Date.now(),
              sessionId,
              error: {
                name: 'QuotaExhausted',
                message: `Token quota exhausted. Remaining: ${result.remaining.promptTokens}`,
              },
              step: state.step,
            }, state },
            { event: {
              type: 'done',
              timestamp: Date.now(),
              sessionId,
              reason: 'quota_exhausted',
            }, state },
          ] as StepContext[]);
        }
        
        // 配额充足 → 继续调用LLM
        return config.streaming ? callLLMStreaming(state) : callLLM(state);
      })
    );
  }
  
  // 无配额控制 → 直接调用
  return config.streaming ? callLLMStreaming(state) : callLLM(state);
}

// 在 llm.response 后消费配额
function callLLM(state: AgentState): Observable<StepContext> {
  return from(ctx.llm.chat(state.messages, llmOptions)).pipe(
    mergeMap(response => {
      // 消费配额 (fire-and-forget)
      if (ctx.quota && response.usage) {
        ctx.quota.consume(sessionId, {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
        }).catch(err => {
          console.warn('Quota consume failed:', err);
        });
      }
      
      // 继续响应处理...
      const responseEvent: AgentEvent = {
        type: 'llm.response',
        timestamp: Date.now(),
        sessionId,
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason,
        usage: response.usage,
      };
      return of({ event: responseEvent, state } as StepContext);
    }),
  );
}
```

### 7.4 Token 预估工具

```typescript
// src/utils/token-estimate.ts

/** 估算消息的token数量 */
export function estimatePromptTokens(messages: Message[]): number {
  // 简化估算: 每4字符 ≈ 1 token (基于GPT tokenizer近似)
  let totalChars = 0;
  
  for (const msg of messages) {
    totalChars += msg.content.length;
    totalChars += 4;  // role 头部
    if (msg.name) totalChars += msg.name.length;
    if (msg.toolCallId) totalChars += msg.toolCallId.length;
  }
  
  return Math.ceil(totalChars / 4);
}

/** 估算单个文本的token数量 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

### 7.5 配额约束清单

| 约束 | 描述 | 违反后果 |
|------|------|---------|
| **LLM调用前预检查** | 必须在 `handleLLMRequest` 中检查配额 | 超额消耗，成本失控 |
| **配额耗尽发事件** | 发 `agent.error` + `done`，不抛异常 | 流中断，无法恢复 |
| **消费是 fire-and-forget** | `consume()` 不阻塞响应流 | 性能影响 |
| **预估保守原则** | 预估值应略高于实际 | 配额检查通过但实际超限 |

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

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 2026-04-24 | 初始设计 - 生命周期/竞态/错误边界 |
| v2 | 2026-04-25 | 新增背压策略配置 |
| v3 | 2026-04-26 | **新增性能约束** - 算法复杂度/异步并行化/资源清理 |
| v4 | 2026-04-26 | **P0 新增**: 配额管控约束 - QuotaController/LLM调用前预检查 |
