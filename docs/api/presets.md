# 预设组合

预设组合是预配置的操作符组合，用于常见场景。

## productionPreset

生产环境预设，包含超时、重试、追踪、指标和检查点。

```typescript
function productionPreset(
  config: ProductionPresetConfig
): MonoTypeOperatorFunction<AgentEvent>;
```

### ProductionPresetConfig

```typescript
interface ProductionPresetConfig {
  timeout?: number;              // 默认 60000ms
  maxRetries?: number;           // 默认 3
  retryDelay?: number;           // 默认 1000ms
  tracer: Tracer;
  metrics: Metrics;
  checkpointStorage: CheckpointStorage;
  sessionId: string;
  checkpointEvents?: AgentEvent['type'][]; // 默认 ['llm.response', 'tool.result']
  timeoutEventType?: AgentEvent['type'];   // 默认 'llm.response'
  retryEventType?: AgentEvent['type'];     // 默认 'llm.error'
}
```

### 包含的操作符

1. `timeoutOnEventType` - 超时保护
2. `retryOnEventType` - 可恢复错误重试
3. `traceEvents` - 分布式追踪
4. `recordMetrics` - 指标收集
5. `checkpoint` - 检查点保存

### 示例

```typescript
import { productionPreset } from 'agentforge/operators';
import { MyTracer, MyMetrics, SQLiteCheckpointStorage } from './observability';

const tracer = new MyTracer();
const metrics = new MyMetrics();
const storage = new SQLiteCheckpointStorage();

agent.run$('Hello').pipe(
  productionPreset({
    tracer,
    metrics,
    checkpointStorage: storage,
    sessionId: 'session-123',
    timeout: 30000,
    maxRetries: 3,
  })
).subscribe();
```

---

## debugPreset

调试环境预设，包含详细日志。

```typescript
function debugPreset(
  configOrLogger?: Logger | DebugPresetConfig
): MonoTypeOperatorFunction<AgentEvent>;
```

### DebugPresetConfig

```typescript
interface DebugPresetConfig {
  logger?: Logger;
  logAllEvents?: boolean;        // 默认 true
  alwaysLogTypes?: AgentEvent['type'][]; // 默认 ['agent.error', 'done']
}
```

### 包含的操作符

1. `logEvents` - 事件日志
2. 错误日志 - 带 stack trace
3. 完成日志 - 流完成通知

### 示例

```typescript
import { debugPreset } from 'agentforge/operators';

// 默认配置
agent.run$('Hello').pipe(
  debugPreset()
);

// 自定义 logger
const winstonLogger = {
  debug: (msg, data) => winston.debug(msg, data),
  info: (msg, data) => winston.info(msg, data),
  warn: (msg, data) => winston.warn(msg, data),
  error: (msg, data) => winston.error(msg, data),
};

agent.run$('Hello').pipe(
  debugPreset(winstonLogger)
);

// 仅记录关键事件
agent.run$('Hello').pipe(
  debugPreset({
    logAllEvents: false,
    alwaysLogTypes: ['agent.start', 'agent.error', 'agent.complete', 'done'],
  })
);
```

---

## testPreset

测试环境预设，简化的事件收集。

```typescript
function testPreset(
  config?: TestPresetConfig
): MonoTypeOperatorFunction<AgentEvent>;
```

### TestPresetConfig

```typescript
interface TestPresetConfig {
  onEvent?: (event: AgentEvent) => void;
  onTerminal?: (event: AgentEvent) => void;
  verbose?: boolean;             // 默认 false
  verboseTypes?: AgentEvent['type'][]; // 默认关键事件
}
```

### 包含的操作符

1. 事件收集回调 - 用于测试断言
2. 终端事件检测
3. 可选 verbose 日志

### 示例

```typescript
import { testPreset } from 'agentforge/operators';
import { firstValueFrom, toArray } from 'rxjs';

const collectedEvents: AgentEvent[] = [];

const result$ = agent.run$('Hello').pipe(
  testPreset({
    onEvent: event => collectedEvents.push(event),
    onTerminal: event => console.log('Terminal:', event.type),
    verbose: true,
  })
);

await firstValueFrom(result$.pipe(toArray()));

// 测试断言
expect(collectedEvents.length).toBeGreaterThan(0);
expect(collectedEvents.some(e => e.type === 'agent.complete')).toBe(true);
```

---

## createPreset

创建自定义预设。

```typescript
function createPreset(
  operators: MonoTypeOperatorFunction<AgentEvent>[]
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { createPreset, logEvents, recordMetrics } from 'agentforge/operators';

const myPreset = createPreset([
  logEvents(myLogger),
  recordMetrics(myMetrics),
  timeoutOnEventType('done', 30000),
]);

agent.run$('Hello').pipe(
  myPreset
);
```

---

## 在 createAgent 中使用预设

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: 'openai/gpt-4o',
  preset: 'production',
  tracing: { exporter: 'console' },
  metrics: {},
  checkpoint: { storage: 'memory' },
});

// 或使用 debug 预设
const debugAgent = createAgent({
  name: 'debug-agent',
  model: 'openai/gpt-4o',
  preset: 'debug',
});

// 或使用 test 预设
const testAgent = createAgent({
  name: 'test-agent',
  model: 'openai/gpt-4o',
  preset: 'test',
});
```

## 预设选择指南

| 场景 | 推荐预设 |
|------|---------|
| 生产环境 | `productionPreset` |
| 开发调试 | `debugPreset` |
| 单元���试 | `testPreset` |
| 自定义场景 | `createPreset` |

## 相关 API

- [控制流操作符](/api/operators-control) - 流控制
- [通知操作符](/api/operators-notify) - 日志和指标
- [createAgent](/api/create-agent) - Agent 创建