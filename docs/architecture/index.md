# 架构概览

AgentForge 的架构设计遵循函数式编程和响应式编程原则。

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent API                             │
│                    createAgent()                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Agent Loop                           │   │
│  │                                                       │   │
│  │   run() ──► Observable<AgentEvent>                    │   │
│  │              │                                        │   │
│  │              ▼                                        │   │
│  │         expand(step) ──► 递归处理                      │   │
│  │              │                                        │   │
│  │              ▼                                        │   │
│  │     ┌────────────────────┐                            │   │
│  │     │   Plugin Pipeline   │                            │   │
│  │     │  Interceptors (←→)  │                            │   │
│  │     │   Observers (→)     │                            │   │
│  │     └────────────────────┘                            │   │
│  │              │                                        │   │
│  │              ▼                                        │   │
│  │     ┌────────────────────┐                            │   │
│  │     │   Event Handlers   │                            │   │
│  │     │  • handleLLM       │                            │   │
│  │     │  • handleTool      │                            │   │
│  │     │  • handleHITL      │                            │   │
│  │     └────────────────────┘                            │   │
│  │                                                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                    DI Interfaces                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │   LLM   │ │  Tools  │ │  HITL   │ │Checkpoint│           │
│  │ Adapter │ │Registry │ │Controller│ │ Storage │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
├─────────────────────────────────────────────────────────────┤
│                    Core Types                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ Events  │ │  State  │ │Checkpoint│ │ Contracts│           │
│  │  (Zod)  │ │(Immutable)│ │ (Zod)  │ │ (Tier 1) │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## 设计原则

### 1. 错误即事件

**原则**：所有错误都作为事件发出，不使用 RxJS 错误通道。

```typescript
// ❌ 错误做法：抛出异常
throw new Error('LLM failed');

// ✅ 正确做法：发出错误事件
return from([
  { type: 'agent.error', error: serializeError(err) },
  { type: 'done', reason: 'error' },
]);
```

**好处**：
- 错误不会中断订阅
- 错误可追溯、可重试
- 统一的错误处理模式

### 2. Observable 异步

**原则**：所有异步操作都通过 Observable 表达。

```typescript
// ❌ 错误做法：直接返回 Promise
expand(() => promise);

// ✅ 正确做法：包装为 Observable
expand(() => from(promise).pipe(mergeMap(arr => from(arr))));
```

**好处**：
- 统一的异步抽象
- 支持取消和背压
- 可组合的操作符

### 3. 轻量依赖注入

**原则**：无 IoC 容器，通过闭包注入依赖。

```typescript
// ❌ 错误做法：IoC 容器
@injectable()
class Agent {
  constructor(@inject(LLMAdapter) llm) {}
}

// ✅ 正确做法：闭包注入
const agent = createAgent({
  llm: myLLMAdapter,
  tools: myToolRegistry,
});
```

**好处**：
- 无魔法，显式依赖
- 易于测试
- 无运行时开销

### 4. Hook 横向切片

**原则**：插件用于横向扩展，DI 用于纵向替换。

```
横向扩展 (插件)：
┌─────────────────────────────────┐
│         Event Stream            │
├─────────────────────────────────┤
│ PIIScrubberPlugin               │ ← 横向切片
│ ApprovalGatePlugin              │ ← 横向切片
│ AuditLogPlugin                  │ ← 横向切片
└─────────────────────────────────┘

纵向替换 (DI)：
┌─────────────────────────────────┐
│         AgentContext            │
├─────────────────────────────────┤
│ llm: OpenAIAdapter              │ ← 可替换为 AnthropicAdapter
│ tools: ToolRegistry             │ ← 可替换为自定义实现
│ checkpoint: FileStorage         │ ← 可替换为 RedisStorage
└─────────────────────────────────┘
```

## 数据流

### 正常流程

```
用户输入
    │
    ▼
agent.start ──────────────────────────────────────────────┐
    │                                                      │
    ▼                                                      │
agent.step (step: 1)                                      │
    │                                                      │
    ▼                                                      │
llm.request ──────────► [Plugin Pipeline] ──────────────► LLM
    │                                                      │
    ▼                                                      │
llm.response ◄────────────────────────────────────────────┘
    │
    ├──► finishReason: 'stop' ──► agent.complete ──► done
    │
    └──► finishReason: 'tool_calls'
              │
              ▼
         tool.call ──► execute() ──► tool.result
              │
              ▼
         agent.step (step: 2)
              │
              ▼
         llm.request ──► ... 循环
```

### 错误流程

```
任何错误
    │
    ▼
agent.error ─────────────────────────────────────
    │                                            │
    ▼                                            │
done (reason: 'error')                          │
                                                 │
订阅者收到完整事件流，包括错误事件 ◄────────────────┘
```

### 取消流程

```
用户取消 / destroy$
    │
    ▼
cancel 事件
    │
    ▼
done (reason: 'cancelled')
```

## 模块结构

```
src/
├── core/                    # 核心类型和接口
│   ├── events.ts           # 事件 Schema (Zod)
│   ├── state.ts            # 状态管理
│   ├── interfaces.ts       # DI 接口
│   ├── checkpoint.ts       # Checkpoint 系统
│   └── state-machine.ts    # 状态机
│
├── loop/                    # Agent 主循环
│   └── agent-loop.ts       # expand 递归核心
│
├── plugins/                 # 插件系统
│   ├── plugin.ts           # 插件接口
│   ├── pipeline.ts         # 管道构建
│   └── manager.ts          # 插件管理
│
├── operators/               # RxJS 操作符
│   ├── control.ts          # 控制流
│   ├── transform.ts        # 变换
│   ├── notify.ts           # 通知
│   └── presets.ts          # 预设
│
├── adapters/                # LLM 适配器
│   ├── openai.ts           # OpenAI
│   └── anthropic.ts        # Anthropic
│
├── subagent/                # 子 Agent
├── mcp/                     # MCP 协议
├── workflow/                # 工作流
├── skill/                   # Skill 加载
├── a2a/                     # Agent-to-Agent
│
├── memory/                  # 记忆管理
│   ├── compaction.ts       # 压缩管理
│   └── strategies.ts       # 压缩策略
│
├── quota/                   # 配额控制
├── security/                # 安全模块
└── contracts/               # Tier 1 校验
```

## 性能考量

### 背压控制

```typescript
// 使用 pauseOnSignal 控制流
agent.run(input).pipe(
  pauseOnSignal(pause$, { maxBufferSize: 100 }),
);
```

### 并行工具执行

```typescript
// 工具默认并行执行
// tool.batch 事件表示批量执行
```

### 内存管理

```typescript
// 使用 CompactionManager 压缩历史
import { CompactionManager } from 'agentforge/memory';

const manager = new CompactionManager({
  maxTokens: 4000,
  strategy: 'importance-weighted',
});
```

## 下一步

- [事件流设计](/architecture/event-stream) - 深入事件流
- [状态机](/architecture/state-machine) - 状态转换
- [依赖注入](/architecture/di) - DI 模式
