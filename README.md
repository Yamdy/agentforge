# AgentForge

> Production-ready Agent framework with MPU (Minimum Production Usable) modules - RxJS event stream + Zod type safety

AgentForge 是一个基于 **RxJS 事件流** + **Zod 类型安全** 的 Agent 框架底座，提供可观测、可中断、可恢复的智能体构建能力。

## 特性

- 🔄 **RxJS 事件流** - 所有操作都是 `Observable<AgentEvent>` 的变换，天然可观测、可组合
- 🛡️ **Zod 类型安全** - 运行时验证 + TypeScript 类型推断，事件结构有保障
- ⏸️ **可中断/可恢复** - `takeUntil()`, checkpoint 机制支持暂停和恢复
- 🔌 **插件系统** - Hook 横向切片，DI 纵向替换，异常隔离不穿透
- 🧩 **工具集成** - Zod Schema 定义工具，自动生成 FunctionDefinition
- 📡 **A2A 协议** - Agent-to-Agent 跨进程通信，支持 request/notify/broadcast
- 📦 **Skill 系统** - SKILL.md 格式知识包，热加载支持
- 🏭 **MPU 模块** - 10 个生产级模块，开箱即用

## MPU 模块

| 模块 | 说明 | 导入 |
|------|------|------|
| M1 | SQLite 持久化存储 | `@primo512109/agentforge/storage` |
| M2 | 任务规划引擎 | `@primo512109/agentforge/planning` |
| M3 | Docker 沙箱隔离 | `@primo512109/agentforge/sandbox` |
| M4 | 异常熔断 | `@primo512109/agentforge/resilience` |
| M5 | 审计日志 | `@primo512109/agentforge/audit` |
| M6 | 工具安全 | `@primo512109/agentforge/security` |
| M7 | 成本管控 | `@primo512109/agentforge/quota` |
| M8 | 可观测性 | `@primo512109/agentforge/observability` |
| M9 | 优雅关闭 | `@primo512109/agentforge/lifecycle` |
| M10 | 结果校验 | `@primo512109/agentforge/validation` |

## 安装

```bash
npm install @primo512109/agentforge
```

## 快速开始

### Quickstart API（最简单）

零配置 API，类似 Mastra 的开发体验：

```typescript
import { Agent, tool } from 'agentforge/quickstart';
import { z } from 'zod';

// 定义工具
const weatherTool = tool({
  description: 'Get weather for a city',
  parameters: z.object({ city: z.string() }),
  execute: async (args) => ({ temp: 22, city: args.city }),
});

// 创建 Agent（自动注册 adapter）
const agent = new Agent({
  name: 'weather-agent',
  model: 'openai/gpt-4o-mini',
  systemPrompt: 'You are a helpful weather assistant.',
  tools: { weather: weatherTool },
});

// 运行
const result = await agent.generate('What is the weather in Tokyo?');
console.log(result.text);
```

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

### 多轮对话

通过 `history` 字段传入对话记录，实现多轮上下文：

```typescript
const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  history: [
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
  ],
});

// LLM 会看到完整的历史上下文
const result = await agent.run('What are its benefits?');
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
| [05-real-llm.ts](./examples/05-real-llm.ts) | **真实 LLM 示例** (AI SDK) |
| [12-multi-turn.ts](./examples/12-multi-turn.ts) | **多轮对话** (history 字段) |

### 真实 LLM 集成

使用 `@ai-sdk/openai-compatible` 支持 OpenAI、Groq、DeepSeek 等 Provider：

```bash
# 安装依赖
npm install ai @ai-sdk/openai-compatible

# 设置环境变量
export OPENAI_API_KEY=your-api-key

# 或使用其他 Provider
export OPENAI_BASE_URL=https://api.deepseek.com/v1
export OPENAI_API_KEY=your-deepseek-key
export MODEL_NAME=deepseek-chat

# 运行示例
npx tsx examples/05-real-llm.ts
```

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

完整文档见 [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)：

### 快速导航

| 分类 | 说明 | 链接 |
|------|------|------|
| **设计文档** | 核心架构设计 | [docs/design/](./docs/design/) |
| **分析文档** | 框架对比分析 | [docs/analysis/](./docs/analysis/) |
| **架构文档** | 架构改进设计 | [docs/architecture/](./docs/architecture/) |
| **用户指南** | 快速上手指南 | [docs/guide/](./docs/guide/) |
| **API 参考** | 详细 API 说明 | [docs/api/](./docs/api/) |
| **开发计划** | 功能实现计划 | [docs/plans/](./docs/plans/) |
| **规格文档** | 设计规格规范 | [docs/specs/](./docs/specs/) |
| **项目管理** | 项目状态交接 | [docs/project/](./docs/project/) |

## License

MIT
