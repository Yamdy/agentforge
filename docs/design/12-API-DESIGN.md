# API 设计

> 本文档定义 AgentForge 的三层 API 设计：零代码（L1）、配置式（L2）、编程式（L3）。

---

## 三层 API 概览

| 层次 | 目标用户 | 特点 | 示例 |
|------|---------|------|------|
| **L1: 零代码** | 非程序员 | 配置文件 | Markdown/JSON |
| **L2: 配置式** | 应用开发者 | 声明式配置 + 回调 | `createAgent(config)` |
| **L3: 编程式** | 框架开发者 | 完全控制 | `Observable<AgentEvent>` |

---

## L1: 零代码（配置文件）

```markdown
<!-- agentforge.config.md -->
---
name: assistant
model:
  provider: openai
  model: gpt-4o
tools: [read, write, bash]
maxSteps: 10
timeout: 60000
retry: 3
tracing: true
checkpoint:
  storage: sqlite
  path: ./checkpoints.db
---

You are a helpful AI assistant. Be concise and accurate.
```

```bash
# CLI 运行
agentforge run "Hello, help me with..."
```

---

## L2: 配置式（推荐）

```typescript
import { createAgent } from 'agentforge';

// === 创建 Agent（声明式配置） ===

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  tools: ['read', 'write', 'bash'],
  maxSteps: 10,

  // 控制流
  timeout: 60000,
  retry: 3,

  // 可观测性
  tracing: true,
  checkpoint: { storage: 'sqlite', path: './checkpoints.db' },

  // HITL
  hitl: {
    onPermissionAsk: async (ask) => {
      return await showPermissionDialog(ask);
    },
  },

  // 子系统
  subagents: [
    { name: 'explorer', model: { provider: 'openai', model: 'gpt-4o-mini' }, tools: ['grep', 'glob'] },
  ],
  mcp: [
    { name: 'github', type: 'stdio', command: 'gh-mcp' },
  ],
});

// === 执行方式 ===

// 方式 1: Promise（返回最终结果）
const result = await agent.run('Hello, how are you?');
console.log(result);

// 方式 2: 流式回调
agent.stream('Tell me a story', {
  onText: (delta) => process.stdout.write(delta),
  onToolCall: (name, args) => console.log(`[Tool: ${name}]`, args),
  onToolResult: (name, result) => console.log(`[Result: ${name}]`, result),
  onStep: (step, maxSteps) => console.log(`Step ${step}/${maxSteps}`),
  onComplete: (result) => console.log('\nDone:', result),
  onError: (error) => console.error('Error:', error),
});

// 方式 3: 事件监听（可选，面向高级用户）
const unsubscribe = agent.on('tool.result', (event) => {
  metrics.record(event);
});

// === 控制 ===

// 取消
agent.cancel('user requested');

// 暂停 + 恢复
const checkpoint = await agent.pause();
// ... later
await agent.resume(checkpoint);
```

---

## L3: 编程式（RxJS 完全控制）

```typescript
import { createAgent, Observable } from 'agentforge';
import { filter, timeout, retry, tap, takeUntil } from 'rxjs/operators';

const agent = createAgent(config);

// 完全控制事件流
agent.run$('Hello').pipe(
  // 控制流
  timeout(60000),
  retry(3),
  takeUntil(cancel$),

  // 过滤（只看工具事件）
  filter((e) => e.type.startsWith('tool.')),

  // 打点
  tap((event) => {
    tracer.record(event);
    metrics.increment(`event.${event.type}`);
  }),
).subscribe({
  next: (event) => console.log(event),
  error: (err) => console.error(err),
  complete: () => console.log('Done'),
});
```

---

## Agent 接口

```typescript
// src/index.ts

export interface Agent {
  // === 执行 ===

  /** Promise 方式运行，返回最终结果 */
  run(input: string): Promise<string>;

  /** 流式回调方式运行 */
  stream(input: string, handlers: StreamHandlers): AgentSubscription;

  /** RxJS 方式运行（L3 用户） */
  run$(input: string): Observable<AgentEvent>;

  // === 控制 ===

  /** 取消当前执行 */
  cancel(reason?: string): void;

  /** 暂停当前执行（保存检查点） */
  pause(): Promise<Checkpoint>;

  /** 从检查点恢复 */
  resume(checkpoint: Checkpoint): Promise<string>;

  // === 事件监听 ===

  /** 监听特定事件类型 */
  on(eventType: AgentEventType, handler: (event: AgentEvent) => void): () => void;

  // === 动态配置 ===

  /** 动态添加操作符 */
  use(operator: OperatorFunction<AgentEvent, AgentEvent>): this;

  /** 动态注册工具 */
  registerTool(tool: Tool | Tool[]): this;
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, isError?: boolean) => void;
  onStep?: (step: number, maxSteps: number) => void;
  onComplete?: (result: string) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: AgentEvent) => void;  // 高级用户
}

export interface AgentSubscription {
  /** 取消执行 */
  unsubscribe(): void;
  /** 等待完成 */
  result: Promise<string>;
}
```

---

## 配置 → 操作符 映射

| 配置项 | 内部操作符 |
|--------|-----------|
| `timeout: 60000` | `timeout(60000)` |
| `retry: 3` | `retry(3)` |
| `tracing: true` | `tap(tracer.record)` |
| `checkpoint: {...}` | `tap(checkpoint.save)` |
| `hitl.onPermissionAsk` | 注入到工具执行的 HITL 控制器 |

---

## 相关文档

- [00-OVERVIEW.md](./00-OVERVIEW.md) - 架构总览
- [03-DI.md](./03-DI.md) - 轻量依赖注入
- [05-EVENT-STREAM.md](./05-EVENT-STREAM.md) - 事件流底座
- [10-FEATURES.md](./10-FEATURES.md) - 特性实现
- [11-OPERATORS.md](./11-OPERATORS.md) - 操作符库
- [13-EXAMPLES.md](./13-EXAMPLES.md) - 使用示例

## 用户文档对照

- [createAgent API](/docs/api/create-agent.md) - L2 配置式 API 实现参考
- [runAgent API](/docs/api/run-agent.md) - L3 编程式 API 实现参考
- [操作符控制流](/docs/api/operators-control.md) - 控制流操作符使用指南
