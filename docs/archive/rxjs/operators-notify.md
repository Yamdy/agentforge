# 通知操作符

通知操作符用于副作用：日志记录、追踪、指标收集、检查点保存。所有操作符使用 `tap`，不阻塞主流程。

## Logger 接口

```typescript
interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}
```

---

## logEvents

记录所有事件日志。

```typescript
function logEvents(
  logger?: Logger
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { logEvents } from 'agentforge/operators';

// 使用默认 console logger
source$.pipe(logEvents());

// 自定义 logger
const myLogger = {
  debug: (msg, data) => console.debug(msg, data),
  info: (msg, data) => console.info(msg, data),
  warn: (msg, data) => console.warn(msg, data),
  error: (msg, data) => console.error(msg, data),
};

source$.pipe(logEvents(myLogger));
```

---

## traceEvents

分布式追踪事件。

```typescript
function traceEvents(
  tracer: Tracer
): MonoTypeOperatorFunction<AgentEvent>;
```

### Tracer 接口

```typescript
interface Tracer {
  startSpan(name: string, options?: SpanOptions): string;
  endSpan(spanId: string, options?: { code?: string }): void;
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void;
  recordException(spanId: string, error: Error): void;
}
```

### 示例

```typescript
import { traceEvents } from 'agentforge/operators';
import { MyTracer } from './my-tracer';

const tracer = new MyTracer();

source$.pipe(
  traceEvents(tracer)
);
```

---

## recordMetrics

记录指标统计数据。

```typescript
function recordMetrics(
  metrics: Metrics
): MonoTypeOperatorFunction<AgentEvent>;
```

### Metrics 接口

```typescript
interface Metrics {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}
```

### 记录的指标

| 指标名称 | 类型 | 说明 |
|---------|------|------|
| `agent.event.{type}` | Counter | 每种事件类型计数 |
| `llm.tokens.prompt` | Histogram | Prompt token 数 |
| `llm.tokens.completion` | Histogram | Completion token 数 |
| `tool.execution.count` | Counter | 工具执行次数 |
| `agent.error.count` | Counter | 错误计数 |

### 示例

```typescript
import { recordMetrics } from 'agentforge/operators';
import { MyMetrics } from './my-metrics';

const metrics = new MyMetrics();

source$.pipe(
  recordMetrics(metrics)
);
```

---

## exportEvents

导出事件到远程系统。

```typescript
function exportEvents(
  exporter: (event: AgentEvent) => Promise<void>,
  onError?: (error: Error) => void
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { exportEvents } from 'agentforge/operators';

source$.pipe(
  exportEvents(
    async (event) => {
      await fetch('https://api.example.com/events', {
        method: 'POST',
        body: JSON.stringify(event),
      });
    },
    (error) => console.warn('Export failed:', error)
  )
);
```

---

## checkpoint

保存检查点。

```typescript
function checkpoint(
  storage: CheckpointStorage,
  sessionId: string,
  shouldCheckpoint: (event: AgentEvent) => boolean,
  stateProvider?: () => AgentState | undefined
): MonoTypeOperatorFunction<AgentEvent>;
```

### CheckpointPosition

检查点位置由事件类型决定：

| 事件类型 | 位置 |
|---------|------|
| `llm.request` | `before_llm` |
| `llm.response` | `after_llm` |
| `tool.execute` | `before_tool` |
| `tool.result` | `after_tool` |

### 示例

```typescript
import { checkpoint } from 'agentforge/operators';
import { SQLiteCheckpointStorage } from './storage';

const storage = new SQLiteCheckpointStorage();

source$.pipe(
  checkpoint(
    storage,
    'session-123',
    // 在 LLM 响应后保存
    event => event.type === 'llm.response',
    // 提供当前状态
    () => currentAgentState
  )
);
```

### 无状态提供者

如果不提供 stateProvider，保存占位符状态：

```typescript
source$.pipe(
  checkpoint(
    storage,
    'session-123',
    event => event.type === 'tool.result'
    // 无 stateProvider -> 占位符状态
  )
);
```

## 错误处理

所有通知操作符遵循错误隔离原则：

- 使用 `tap` 进行副作用
- 异步操作使用 fire-and-forget
- 错误被静默捕获，不传播
- 永远不阻塞主事件流

```typescript
// 即使 exporter 抛出错误，主流程继续
source$.pipe(
  exportEvents(
    async (event) => {
      throw new Error('Network error');
    }
  )
).subscribe({
  next: (event) => console.log(event), // 正常收到事件
  complete: () => console.log('Done')  // 正常完成
});
```

## 相关 API

- [控制流操作符](/api/operators-control) - 流控制
- [变换操作符](/api/operators-transform) - 事件变换
- [预设](/api/presets) - 预设组合