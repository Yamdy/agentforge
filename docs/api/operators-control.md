# 控制流操作符

控制流操作符用于管理 Agent 事件流的执行流程，包括超时、重试、暂停等。

## retryOnEventType

监听错误事件并重试。

```typescript
function retryOnEventType(
  eventType: AgentEventType,
  count: number,
  delay?: number // 默认 1000ms
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { retryOnEventType } from 'agentforge/operators';
import { of } from 'rxjs';

source$.pipe(
  // LLM 错误时重试 3 次，每次延迟 500ms
  retryOnEventType('llm.error', 3, 500)
);
```

### 重试机制

- 监听流中的指定错误事件类型
- 当流正常完成时检查是否有匹配错误
- 使用指数退避：delay * 2^(retryCount-1)
- 达到最大重试次数后正常完成

---

## timeoutOnEventType

等待指定事件类型，超时触发错误。

```typescript
function timeoutOnEventType(
  eventType: AgentEventType,
  ms: number
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { timeoutOnEventType } from 'agentforge/operators';

source$.pipe(
  // 30 秒内未收到 llm.response 则超时
  timeoutOnEventType('llm.response', 30000)
);
```

### 超时行为

- 收到目标事件后清除超时
- 每个事件重置超时计时器
- 超时时发送 `agent.error` + `done` 事件

---

## maxStepsLimit

限制最大步骤数。

```typescript
function maxStepsLimit(max: number): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { maxStepsLimit } from 'agentforge/operators';

source$.pipe(
  // 最多 10 步
  maxStepsLimit(10)
);
```

### 限制行为

- 监听 `agent.step` 事件
- 当步骤数超过限制时发送错误并完成
- finishReason 为 `'length'`

---

## requirePermission

权限检查操作符。

```typescript
function requirePermission(
  check: (event: AgentEvent) => boolean | Promise<boolean>
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { requirePermission } from 'agentforge/operators';

source$.pipe(
  requirePermission(async (event) => {
    if (event.type === 'tool.call') {
      // 阻止危险工具
      return event.toolName !== 'delete_file';
    }
    return true;
  })
);
```

### 权限拒绝行为

- 返回 `false` 时发送权限错误
- 发送 `agent.error` + `done` 事件
- 错误名称：`PermissionDeniedError`

---

## pauseOnSignal

暂停/恢复操作符。

```typescript
function pauseOnSignal(
  signal$: Observable<boolean>,
  options?: { maxBufferSize?: number }
): MonoTypeOperatorFunction<AgentEvent>;
```

### 示例

```typescript
import { pauseOnSignal } from 'agentforge/operators';
import { Subject } from 'rxjs';

const pauseSignal$ = new Subject<boolean>();

source$.pipe(
  pauseOnSignal(pauseSignal$)
).subscribe();

// 暂停
pauseSignal$.next(true);

// 恢复（释放缓冲事件）
pauseSignal$.next(false);
```

### 暂停行为

- `true` = 暂停，事件缓冲
- `false` = 恢复，释放缓冲事件
- 缓冲溢出时丢弃新事件并发出警告
- 默认缓冲区大小：1000

---

## 内部辅助函数

### _createErrorEvent

```typescript
function _createErrorEvent(
  error: unknown,
  sessionId: string,
  step?: number
): AgentEvent;
```

创建 `agent.error` 事件。

### _createDoneEvent

```typescript
function _createDoneEvent(
  sessionId: string,
  reason?: 'stop' | 'error' | 'cancelled' | 'length'
): AgentEvent;
```

创建 `done` 事件。

## 相关 API

- [变换操作符](/api/operators-transform) - 事件变换
- [通知操作符](/api/operators-notify) - 日志和指标
- [预设](/api/presets) - 预设组合