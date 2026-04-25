# AgentForge

> Agent framework based on RxJS event stream + Zod type safety

AgentForge 是一个基于 **RxJS 事件流** + **Zod 类型安全** 的 Agent 框架底座，提供可观测、可中断、可恢复的智能体构建能力。

## 特性

- 🔄 **RxJS 事件流** - 所有操作都是 `Observable<AgentEvent>` 的变换，天然可观测、可组合
- 🛡️ **Zod 类型安全** - 运行时验证 + TypeScript 类型推断，事件结构有保障
- ⏸️ **可中断/可恢复** - `takeUntil()`, checkpoint 机制支持暂停和恢复
- 🔌 **插件系统** - Hook 横向切片，DI 纵向替换，异常隔离不穿透
- 🧩 **工具集成** - Zod Schema 定义工具，自动生成 FunctionDefinition
- 📡 **A2A 协议** - Agent-to-Agent 跨进程通信，支持 request/notify/broadcast
- 📦 **Skill 系统** - SKILL.md 格式知识包，热加载支持

## 安装

```bash
npm install agentforge
```

## 快速开始

### L2 API（推荐）

配置驱动的声明式 API，适合大多数开发者：

```typescript
import { createAgent } from 'agentforge';

const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  tools: ['read', 'write', 'bash'],
  maxSteps: 10,
  preset: 'production',
});

// Promise 模式
const result = await agent.run('Hello, how can you help?');

// Stream 模式
agent.stream('Hello', {
  onStep: (step) => console.log(`Step ${step}`),
  onComplete: (output) => console.log(output),
  onError: (error) => console.error(error),
});
```

### L3 API（高级）

编程式 API，提供完整的 Observable 控制能力：

```typescript
import { createAgentLoop, ContextBuilder } from 'agentforge';
import { timeoutOnEventType, retryOnEventType, collectMetrics } from 'agentforge';

const ctx = new ContextBuilder()
  .withLLMAdapter(myLLMAdapter)
  .withToolRegistry(myToolRegistry)
  .build();

const loop = createAgentLoop(ctx, { maxSteps: 10 });

loop.run$('Hello!')
  .pipe(
    timeoutOnEventType('done', 30000),
    retryOnEventType('agent.error', 3),
    collectMetrics({ increment: (key) => {...} }),
  )
  .subscribe({
    next: (event) => console.log(event.type),
    complete: () => console.log('Done!'),
  });
```

## 核心概念

### 事件流架构

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   所有操作 = Observable<AgentEvent> 的变换                   │
│                                                             │
│   Agent Loop = expand(事件 → 下一步事件流)                   │
│                                                             │
│   类型安全 = Zod Schema 验证所有事件                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 事件类型

```typescript
// Layer 1: Core Agent Loop
'agent.start' | 'agent.step' | 'agent.complete' | 'agent.error' |
'llm.request' | 'llm.response' | 'llm.error' |
'tool.call' | 'tool.execute' | 'tool.result' | 'tool.error' |
'hitl.ask' | 'hitl.answer' | 'done' | 'cancel'

// Layer 2: Subsystem Lifecycle
'subagent.start' | 'subagent.complete' |
'mcp.connected' | 'mcp.tools_changed' |
'workflow.start' | 'workflow.complete'
```

### 操作符库

| 操作符 | 用途 |
|--------|------|
| `filterEventType` | 过滤特定事件类型 |
| `takeUntilTerminal` | 直到终端事件 |
| `collectMetrics` | 收集指标统计 |
| `timeoutOnEventType` | 基于事件类型的超时 |
| `retryOnEventType` | 基于事件类型的重试 |
| `checkpoint` | 保存检查点 |
| `logEvents` | 事件日志 |
| `productionPreset` | 生产环境预设组合 |

## 示例

查看 [examples/](./examples/) 目录：

| 文件 | 内容 |
|------|------|
| [01-basic-usage.ts](./examples/01-basic-usage.ts) | L2/L3 API 基本使用 |
| [02-operators.ts](./examples/02-operators.ts) | 操作符组合使用 |
| [03-tools.ts](./examples/03-tools.ts) | 工具定义与注册 |
| [04-checkpoint.ts](./examples/04-checkpoint.ts) | 检查点保存与恢复 |

## 项目结构

```
src/
├── core/           # 核心类型和接口
│   ├── events.ts   # 50+ Zod 事件 Schema
│   ├── state.ts    # AgentState 状态定义
│   ├── checkpoint.ts # 检查点系统
│   ├── interfaces.ts # DI 接口定义
│   └── context-builder.ts # Context 构建器
├── loop/           # Agent 循环核心
│   └── agent-loop.ts # expand 递归引擎
├── operators/      # RxJS 操作符库
│   ├── control.ts  # 控制流操作符
│   ├── transform.ts # 变换操作符
│   ├── notify.ts   # 通知操作符
│   └── presets.ts  # 预设组合
├── plugins/        # 插件系统
│   ├── plugin.ts   # Plugin 接口
│   ├── pipeline.ts # 管道构建
│   └── manager.ts  # 生命周期管理
├── skill/          # Skill 系统
│   ├── loader.ts   # SKILL.md 加载器
│   ├── parser.ts   # YAML 解析器
│   └── watcher.ts  # 热加载监听
├── a2a/            # Agent-to-Agent 协议
│   ├── client.ts   # A2A 客户端
│   ├── connection.ts # 连接管理
│   └── transport.ts # 传输层抽象
├── api/            # 公开 API
│   ├── create-agent.ts # L2 配置式
│   └── run-agent.ts    # L3 编程式
└── index.ts        # 统一导出
```

## 设计原则

### 铁律

1. **RxJS 管好订阅与销毁** - 所有流必须 `takeUntil(destroy$)`
2. **Zod 统一数据契约** - 外部数据 Tier 1 强校验，内部 Tier 3 仅 TypeScript 类型
3. **错误即事件** - 所有错误转换为 `agent.error` 事件，不使用 RxJS 错误通道
4. **Hook 异常隔离** - 单插件报错不拖垮主循环
5. **拦截器用 concatMap** - 阻塞主流程；观察器用 tap - 不阻塞

### 三层 API

| 层次 | 目标用户 | 特点 |
|------|---------|------|
| **L1: 零代码** | 非程序员 | Markdown/JSON 配置文件 |
| **L2: 配置式** | 应用开发者 | `createAgent(config)` |
| **L3: 编程式** | 框架开发者 | 完全控制 `Observable<AgentEvent>` |

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 测试
npm run test

# 测试覆盖率
npm run test:coverage

# 代码检查
npm run lint

# 格式化
npm run format
```

## 文档

详细设计文档见 [docs/architecture/](./docs/architecture/)：

- [RXJS-EVENT-STREAM-DESIGN.md](./docs/architecture/RXJS-EVENT-STREAM-STREAM-DESIGN.md) - 完整架构设计

## License

MIT
