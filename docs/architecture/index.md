# 架构概览

AgentForge 的架构设计遵循函数式编程和事件驱动编程原则。

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
│  │   run() ──► Promise<string>                             │   │
│  │              │                                        │   │
│  │              ▼                                        │   │
│  │         while(true) ──► 命令式循环                        │   │
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

**原则**：所有错误都作为事件发出，不使用异常抛出。

```typescript
// ❌ 错误做法：抛出异常
throw new Error('LLM failed');

// ✅ 正确做法：发出错误事件
emitter.emit({ type: 'agent.error', error: serializeError(err) });
emitter.emit({ type: 'done', reason: 'error' });
```

**好处**：
- 错误不会中断订阅
- 错误可追溯、可重试
- 统一的错误处理模式

### 2. 命令式循环 + await

**原则**：所有异步操作通过 `while(true) + await` 命令式循环表达。

```typescript
// ✅ 正确做法：命令式循环
while (true) {
  const { event, state } = await processStep(currentState);
  if (isTerminalEvent(event)) break;
  currentState = state;
}
```

**好处**：
- 线性可读的控制流
- 支持 AbortController 取消
- 简化的错误处理

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
用户取消 / AbortController
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
│   ├── context.ts          # 3 层 Context 定义
│   ├── context-builder.ts  # ContextBuilder
│   ├── checkpoint.ts       # Checkpoint 系统
│   ├── state-machine.ts    # 状态机
│   └── prompt-builder.ts   # Prompt 构建器
│
├── loop/                    # Agent 主循环
│   └── agent-loop.ts       # while(true) 命令式循环核心
│
├── api/                     # L2/L3 API 层
│   ├── create-agent.ts     # L2: createAgent()
│   ├── run-agent.ts        # L3: runAgent()
│   ├── context-builder.ts  # API 层 ContextBuilder
│   └── types.ts            # AgentConfig / Agent 接口
│
├── plugins/                 # 插件系统
│   ├── plugin.ts           # 插件接口
│   ├── pipeline.ts         # 管道构建
│   └── manager.ts          # 插件管理
│
├── hooks/                    # Hook 系统
│   ├── hooks.ts            # RequestHook / ToolHook / LifecycleHook
│   └── hook-registry.ts   # Hook 注册管理
│
├── adapters/                # LLM 适配器
│   ├── openai.ts           # OpenAI
│   ├── anthropic.ts        # Anthropic
│   └── index.ts            # 适配器工厂
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
├── security/                # 安全模块（权限/沙箱/审计/限流/消毒）
├── observability/           # 资源监控
├── contracts/               # Tier 1 校验（LLM/MCP/用户输入）
```

## 性能考量

### 背压控制

```typescript
// 使用 pause/resume 控制执行
agent.pause();
// ... 稍后恢复
await agent.resume(checkpoint);
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

- [指南](/guide/) - 开始使用 AgentForge
- [API 参考](/api/) - 完整 API 文档

## 设计文档对照

> 以下是本文档与 `design/` 目录中设计文档的对应关系，方便深入阅读。

| 主题 | 设计文档 |
|------|---------|
| 架构总览与核心铁律 | [design/00-OVERVIEW.md](/design/00-OVERVIEW.md) |
| 事件类型与状态定义 | [design/01-CORE-TYPES.md](/design/01-CORE-TYPES.md) |
| 事件流与 EventEmitter 机制 | [design/05-EVENT-STREAM.md](/design/05-EVENT-STREAM.md) |
| 3 层 Context 依赖注入 | [design/03-DI.md](/design/03-DI.md) |
| 插件系统 | [design/07-PLUGIN-SYSTEM.md](/design/07-PLUGIN-SYSTEM.md) |
| Hook 系统 | [design/11-OPERATORS.md](/design/11-OPERATORS.md) |
| API 设计（L1/L2/L3） | [design/12-API-DESIGN.md](/design/12-API-DESIGN.md) |
| 安全架构 | [design/17-SECURITY.md](/design/17-SECURITY.md) |
| 配额集成 | [design/18-QUOTA-INTEGRATION.md](/design/18-QUOTA-INTEGRATION.md) |
| 架构演化路线图 | [design/15-ARCHITECTURE.md](/design/15-ARCHITECTURE.md) |
