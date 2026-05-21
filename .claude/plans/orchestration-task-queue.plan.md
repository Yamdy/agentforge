# Plan: 编排抽象层 + 任务队列 (P1-2)

**Source PRD**: `docs/gap-analysis-server-sdk.md`
**Selected Milestone**: P1 - 编排抽象层 + 任务队列
**Complexity**: Large

## Summary

实现两个 P1 级能力：(1) 编排抽象层支持 Sequential/Parallel/Hierarchical 三种多 Agent 协作模式，(2) 任务队列支持长时间任务的入队、后台执行、状态查询和通知。两个模块共享 Checkpoint 机制实现断点恢复。

**关联计划**：
- 编排抽象层详细设计见 [`orchestration-layer.plan.md`](./orchestration-layer.plan.md)
- 本计划补充任务队列设计和两个模块的集成点

---

## Part A: 编排抽象层

> 详细设计见 [`orchestration-layer.plan.md`](./orchestration-layer.plan.md)

**核心交付**：
- `OrchestrationPipeline` - 链式 API `.step().parallel().branch()`
- `AgentRouter` - 条件路由器
- `ParallelExecutor` - 并行执行器
- 结果聚合器 (concatenate, firstSuccess, voting)

---

## Part B: 任务队列

### B.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: TaskQueue (任务队列)                              │
│  - enqueue(agentId, input) → TaskHandle                    │
│  - getStatus(taskId) → TaskStatus                          │
│  - cancel(taskId) → void                                   │
│  - list(filter?) → TaskHandle[]                            │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Checkpoint (断点)                                │
│  - 复用 LoopOrchestrator.serialize/deserialize             │
│  - 每 iteration 自动 checkpoint                            │
│  - resume(taskId) → 从断点恢复                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Notification (通知)                              │
│  - WebSocket 实时推送                                      │
│  - Webhook 回调                                            │
│  - EventBus 事件订阅                                       │
└─────────────────────────────────────────────────────────────┘
```

### B.2 文件变更

| File | Action | Why |
|---|---|---|
| `packages/sdk/src/index.ts` | UPDATE | 添加 TaskQueue 类型定义 |
| `packages/core/src/task-queue/types.ts` | CREATE | 内部类型定义 |
| `packages/core/src/task-queue/queue.ts` | CREATE | TaskQueue 核心实现 |
| `packages/core/src/task-queue/checkpoint-plugin.ts` | CREATE | 自动 checkpoint 插件 |
| `packages/core/src/task-queue/notification.ts` | CREATE | 通知管理器 |
| `packages/core/src/task-queue/index.ts` | CREATE | 模块导出 |
| `packages/core/src/index.ts` | UPDATE | 导出 task-queue 模块 |
| `packages/core/__tests__/task-queue/*.test.ts` | CREATE | 单元测试 |

---

### B.3 Tasks

#### Task T1: SDK 类型定义

- **Action**: 在 `packages/sdk/src/index.ts` 添加任务队列类型
- **Mirror**: 参考 `AsyncTaskConfig` (`sdk/src/index.ts:862`) 类型风格
- **Validate**: `pnpm --filter @primo-ai/sdk check-types`

```typescript
// 新增类型
export interface TaskQueueConfig {
  maxConcurrency?: number;
  persistence?: 'memory' | 'file';
  checkpointInterval?: number;
}

export interface TaskQueueHandle {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  result?: unknown;
  error?: Error;
  on(event: TaskEvent, handler: TaskEventHandler): void;
  cancel(): void;
}

export type TaskStatus = 'pending' | 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled';
export type TaskEvent = 'progress' | 'complete' | 'error' | 'suspend';

export interface TaskOptions {
  priority?: number;
  timeout?: number;
  parentSessionId?: string;
  autoCheckpoint?: boolean;
}

export interface TaskQueue {
  enqueue(agentId: string, input: unknown, options?: TaskOptions): Promise<TaskQueueHandle>;
  getStatus(taskId: string): Promise<TaskStatus>;
  getResult(taskId: string): Promise<unknown>;
  cancel(taskId: string): Promise<void>;
  resume(taskId: string): Promise<TaskQueueHandle>;
  list(filter?: { status?: TaskStatus; agentId?: string }): Promise<TaskQueueHandle[]>;
}
```

#### Task T2: TaskQueue 核心实现

- **Action**: 实现 `TaskQueue` 类
- **Mirror**: 参考 `TaskManagerImpl.launch()` (`task-manager.ts:110`) 模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/task-queue/queue.test.ts`

```typescript
// packages/core/src/task-queue/queue.ts
import { EventBus } from '../event-bus.js';
import { CheckpointStore, InMemoryCheckpointStore, JsonlCheckpointStore } from '../checkpoint-store.js';
import { ConcurrencyController } from '../concurrency-controller.js';
import { serialize, deserialize } from '../serialize.js';
import type { TaskQueue, TaskQueueConfig, TaskQueueHandle, TaskStatus, TaskOptions } from './types.js';

interface InternalTaskState {
  taskId: string;
  agentId: string;
  input: unknown;
  status: TaskStatus;
  progress?: number;
  result?: unknown;
  error?: Error;
  priority: number;
  createdAt: number;
  abortController?: AbortController;
  eventHandlers: Map<TaskEvent, Set<Function>>;
}

export class TaskQueueImpl implements TaskQueue {
  private tasks = new Map<string, InternalTaskState>();
  private agentRegistry: Map<string, Agent>;
  private concurrencyController: ConcurrencyController;
  private checkpointStore: CheckpointStore;
  private eventBus?: EventBus;

  constructor(
    agentRegistry: Map<string, Agent>,
    config: TaskQueueConfig = {},
  ) {
    this.agentRegistry = agentRegistry;
    // ConcurrencyController requires ConcurrencySlot[] array, not a number
    // See: concurrency-controller.ts:12
    this.concurrencyController = new ConcurrencyController([
      { key: 'default', maxConcurrent: config.maxConcurrency ?? 4 },
    ]);
    this.checkpointStore = config.persistence === 'file'
      ? new JsonlCheckpointStore('.agentforge/task-queue')
      : new InMemoryCheckpointStore();
  }

  async enqueue(agentId: string, input: unknown, options?: TaskOptions): Promise<TaskQueueHandle> {
    const taskId = crypto.randomUUID();
    const state: InternalTaskState = {
      taskId,
      agentId,
      input,
      status: 'pending',
      priority: options?.priority ?? 0,
      createdAt: Date.now(),
      eventHandlers: new Map(),
    };

    this.tasks.set(taskId, state);
    this.eventBus?.emit('task:enqueued', { taskId, agentId, input });

    // 后台执行
    this.executeTask(taskId, options).catch(err => {
      this.handleTaskError(taskId, err);
    });

    return this.createHandle(state);
  }

  async getStatus(taskId: string): Promise<TaskStatus> {
    return this.tasks.get(taskId)?.status ?? 'pending';
  }

  async getResult(taskId: string): Promise<unknown> {
    return this.tasks.get(taskId)?.result;
  }

  async cancel(taskId: string): Promise<void> {
    const state = this.tasks.get(taskId);
    if (state && (state.status === 'pending' || state.status === 'running')) {
      state.abortController?.abort();
      state.status = 'cancelled';
      this.eventBus?.emit('task:cancelled', { taskId });
    }
  }

  async resume(taskId: string): Promise<TaskQueueHandle> {
    const checkpoint = await this.checkpointStore.load(taskId);
    if (!checkpoint) throw new Error(`No checkpoint found for task: ${taskId}`);

    const state = this.tasks.get(taskId);
    if (!state) throw new Error(`Task not found: ${taskId}`);

    state.status = 'pending';
    this.executeTask(taskId, { resumeFrom: checkpoint }).catch(err => {
      this.handleTaskError(taskId, err);
    });

    return this.createHandle(state);
  }

  async list(filter?: { status?: TaskStatus; agentId?: string }): Promise<TaskQueueHandle[]> {
    let states = Array.from(this.tasks.values());
    if (filter?.status) states = states.filter(s => s.status === filter.status);
    if (filter?.agentId) states = states.filter(s => s.agentId === filter.agentId);
    return states.map(s => this.createHandle(s));
  }

  private async executeTask(taskId: string, options?: TaskOptions & { resumeFrom?: unknown }): Promise<void> {
    const state = this.tasks.get(taskId);
    if (!state) return;

    // acquire() requires a pre-defined slot key from constructor
    // See: concurrency-controller.ts:18-22
    const releaseSlot = await this.concurrencyController.acquire('default');
    try {
      state.status = 'running';
      state.abortController = new AbortController();
      this.eventBus?.emit('task:started', { taskId, agentId: state.agentId });

      const agent = this.agentRegistry.get(state.agentId);
      if (!agent) throw new Error(`Agent not found: ${state.agentId}`);

      // 添加自动 checkpoint 插件
      if (options?.autoCheckpoint !== false) {
        agent.use(autoCheckpointPlugin(taskId, this.checkpointStore));
      }

      const result = await agent.run(state.input, state.abortController.signal);
      state.status = 'completed';
      state.result = result;
      this.emitTaskEvent(state, 'complete', result);
      this.eventBus?.emit('task:completed', { taskId, result });
    } catch (err) {
      if (state.abortController?.signal.aborted) {
        state.status = 'cancelled';
        this.eventBus?.emit('task:cancelled', { taskId });
      } else {
        state.status = 'failed';
        state.error = err instanceof Error ? err : new Error(String(err));
        this.emitTaskEvent(state, 'error', state.error);
        this.eventBus?.emit('task:failed', { taskId, error: state.error });
      }
    } finally {
      releaseSlot();
    }
  }

  private createHandle(state: InternalTaskState): TaskQueueHandle {
    return {
      taskId: state.taskId,
      get status() { return state.status; },
      get progress() { return state.progress; },
      get result() { return state.result; },
      get error() { return state.error; },
      on(event, handler) {
        const handlers = state.eventHandlers.get(event) ?? new Set();
        handlers.add(handler);
        state.eventHandlers.set(event, handlers);
      },
      cancel: () => this.cancel(state.taskId),
    };
  }

  private emitTaskEvent(state: InternalTaskState, event: TaskEvent, data: unknown): void {
    const handlers = state.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }

  private handleTaskError(taskId: string, err: unknown): void {
    const state = this.tasks.get(taskId);
    if (state) {
      state.status = 'failed';
      state.error = err instanceof Error ? err : new Error(String(err));
      this.eventBus?.emit('task:error', { taskId, error: state.error });
    }
  }
}
```

#### Task T3: 自动 Checkpoint 插件

- **Action**: 实现自动 checkpoint 插件
- **Mirror**: 参考 `LoopOrchestrator.saveCheckpoint()` (`loop-orchestrator.ts:349`)
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/task-queue/checkpoint.test.ts`

```typescript
// packages/core/src/task-queue/checkpoint-plugin.ts
import type { PluginRegistration, ProcessorContext } from '@primo-ai/sdk';
import type { CheckpointStore } from '../checkpoint-store.js';
import { serialize } from '../serialize.js';

export function autoCheckpointPlugin(taskId: string, store: CheckpointStore): PluginRegistration {
  return {
    name: 'auto-checkpoint',
    processors: [{
      stage: 'evaluateIteration',
      execute: async (pCtx: ProcessorContext) => {
        const ctx = pCtx.state;
        const checkpoint = serialize(ctx);
        await store.save(taskId, checkpoint);
      },
    }],
  };
}
```

#### Task T4: 通知管理器

- **Action**: 实现 `TaskNotificationManager`
- **Mirror**: 参考 `EventBus.emit()` (`event-bus.ts`) 模式
- **Validate**: `pnpm --filter @primo-ai/core vitest run __tests__/task-queue/notification.test.ts`

```typescript
// packages/core/src/task-queue/notification.ts
import type { TaskEvent } from './types.js';

type NotificationHandler = (data: unknown) => void;

export class TaskNotificationManager {
  private websockets = new Set<{ send: (msg: string) => void }>();
  private webhooks = new Set<string>();
  private eventHandlers = new Map<TaskEvent, Set<NotificationHandler>>();

  addWebSocket(ws: { send: (msg: string) => void }): void {
    this.websockets.add(ws);
  }

  removeWebSocket(ws: { send: (msg: string) => void }): void {
    this.websockets.delete(ws);
  }

  addWebhook(url: string): void {
    this.webhooks.add(url);
  }

  removeWebhook(url: string): void {
    this.webhooks.delete(url);
  }

  on(event: TaskEvent, handler: NotificationHandler): void {
    const handlers = this.eventHandlers.get(event) ?? new Set();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
  }

  off(event: TaskEvent, handler: NotificationHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  async notify(event: TaskEvent, data: unknown): Promise<void> {
    const message = JSON.stringify({ type: event, data, timestamp: Date.now() });

    // WebSocket 推送
    for (const ws of this.websockets) {
      try {
        ws.send(message);
      } catch (err) {
        console.error('WebSocket send failed:', err);
      }
    }

    // Webhook 回调
    for (const url of this.webhooks) {
      try {
        await fetch(url, {
          method: 'POST',
          body: message,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('Webhook failed:', err);
      }
    }

    // 内部事件处理器
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
}
```

#### Task T5: 模块导出

- **Action**: 更新 `packages/core/src/index.ts` 导出
- **Validate**: `pnpm --filter @primo-ai/core build`

---

## Part C: 编排与队列集成

### C.1 集成点

1. **OrchestrationPipeline.enqueue()** - 将整个编排作为任务入队
2. **TaskQueue 使用 OrchestrationPipeline** - 队列任务可以是编排任务
3. **共享 CheckpointStore** - 编排和队列共享同一存储

### C.2 集成示例

```typescript
// 创建任务队列，注册 Agent
const agentRegistry = new Map([
  ['planner', plannerAgent],
  ['executor', executorAgent],
  ['reviewer', reviewerAgent],
]);
const taskQueue = new TaskQueueImpl(agentRegistry, { maxConcurrency: 4 });

// 方式 1: 单 Agent 任务
const handle1 = await taskQueue.enqueue('executor', '写一个冒泡排序');

// 方式 2: 编排任务
const pipeline = new OrchestrationPipeline()
  .step('planner', plannerAgent)
  .step('executor', executorAgent)
  .step('reviewer', reviewerAgent);

// 将编排作为任务入队
const handle2 = await taskQueue.enqueue('orchestration', {
  pipeline: pipeline.toJSON(),
  input: '实现一个 REST API',
});

// 查询状态
console.log(await handle2.getStatus()); // 'running'

// 监听事件
handle2.on('complete', (result) => {
  console.log('任务完成:', result);
});
```

---

## Validation

```bash
# 类型检查
pnpm check-types

# 编排测试
pnpm --filter @primo-ai/core vitest run __tests__/orchestration

# 任务队列测试
pnpm --filter @primo-ai/core vitest run __tests__/task-queue

# 构建验证
pnpm build

# 集成测试
pnpm --filter @primo-ai/core vitest run __tests__/integration/orchestration-queue.test.ts
```

---

## Implementation Timeline

| Phase | 内容 | 预计时间 |
|---|---|---|
| Phase 1 | 编排类型定义 + Pipeline 骨架 | 1 天 |
| Phase 2 | 编排核心 (Router, Parallel, Aggregators) | 2 天 |
| Phase 3 | 任务队列核心 (Queue, Checkpoint) | 2 天 |
| Phase 4 | 通知管理 + WebSocket | 1 天 |
| Phase 5 | 集成测试 + 文档 | 1 天 |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| 并发控制复杂 | Medium | 复用 `ConcurrencyController` |
| Checkpoint 性能开销 | Medium | 可配置 checkpointInterval |
| Agent 实例复用状态污染 | Medium | 每次执行前 reset 或创建新实例 |
| WebSocket 连接管理 | Low | 参考现有 Server 实现 |
| 编排嵌套深度 | Low | 设置 maxDepth 限制 |

---

## Adversarial Review Log

### Review Date: 2026-05-20
### Reviewer: Momus Agent

**发现的问题**:

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 1 | `ConcurrencyController` 构造函数签名不匹配 | Task T2 L154 | ✅ 已修复 |
| 2 | `acquire()` 需要预定义的 slot key | Task T2 L226 | ✅ 已修复 |
| 3 | `serialize()` 类型问题 (误报) | Task T3 | ❌ 代码正确 |

**修复详情**:

1. **构造函数修复**: `new ConcurrencyController(4)` → `new ConcurrencyController([{ key: 'default', maxConcurrent: 4 }])`
   - 原因: `ConcurrencyController` 构造函数要求 `ConcurrencySlot[]` 数组

2. **acquire 调用修复**: `acquire(taskId)` → `acquire('default')`
   - 原因: `acquire()` 需要在构造时预定义的 slot key，否则抛出 `Unknown concurrency slot` 错误

---

## Acceptance

- [ ] **编排抽象层** (见 `orchestration-layer.plan.md` Acceptance)
- [ ] TaskQueue.enqueue/getStatus/cancel/resume/list 可用
- [ ] 自动 checkpoint 每 iteration 保存
- [ ] WebSocket 实时推送任务状态
- [ ] Webhook 回调支持
- [ ] 编排任务可入队执行
- [ ] 所有测试通过
- [ ] 类型检查通过
