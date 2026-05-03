# AgentForge

> **The Harness Engine for Production AI Agents** — audit, sandbox, circuit-break, quota-control your agents. Not a new agent framework — a safety layer that wraps yours.
>
> 事件驱动架构 + Zod 类型安全。可观测、可中断、可恢复。

```typescript
// ❌ Without Harness
const agent = new Agent({ model: 'gpt-4o' });
await agent.run('delete temp files');
// rm -rf / executed. No audit. No sandbox. No quota.

// ✅ With AgentForge Harness
const agent = createAgent({
  model: { provider: 'openai', model: 'gpt-4o' },
  harness: {
    sandbox: 'docker',                          // Isolated execution
    audit: true,                                // SHA-256 audit chain
    circuitBreaker: { failureThreshold: 5 },    // Auto circuit-break
    quota: { maxTokens: 50000 },                // Cost control
    qualityGate: true,                          // Output quality validation
  },
});
await agent.run('delete temp files');
// Sandbox blocked, audit logged, quota checked. Zero damage. No tokens burned.
```

AgentForge 是一个 **Agent Harness 框架**，核心理念是：

```
Agent = LLM（认知决策核心）+ Harness（工程管控基座）
```

- **模型负责**：推理、决策、语义理解
- **框架负责**：执行管控、资源约束、状态持久、安全隔离、行为可观测
- **所有 Agent 行为必须经过 Harness 管控，不可绕过**

## 特性

- 🔄 **事件驱动架构** - 所有操作通过 `AgentEventEmitter` 分发，天然可观测、可组合
- 🛡️ **Zod 类型安全** - 运行时验证 + TypeScript 类型推断，事件结构有保障
- ⏸️ **可中断/可恢复** - `AbortController`, checkpoint 机制支持暂停和恢复
- 🔌 **插件系统** - Hook 横向切片（RequestHook/ToolHook/LifecycleHook），DI 纵向替换，异常隔离不穿透
- 🧩 **工具集成** - Zod Schema 定义工具，自动生成 FunctionDefinition
- 📡 **A2A 协议** - Agent-to-Agent 跨进程通信，支持 request/notify/broadcast
- 📦 **Skill 系统** - SKILL.md 格式知识包，热加载支持
- 🏭 **MPU 模块** - 10 个生产级模块，开箱即用

## MPU 模块

| 模块 | 说明 | 导入 | 成熟度 |
|------|------|------|--------|
| M1 | SQLite 持久化存储 | `@primo512109/agentforge/storage` | ✅ 稳定 |
| M2 | 任务规划引擎 | `@primo512109/agentforge/planning` | ✅ 稳定 |
| M3 | Docker 沙箱隔离 | `@primo512109/agentforge/sandbox` | 🔧 开发中 |
| M4 | 异常熔断修复 | `@primo512109/agentforge/resilience` | ✅ 稳定 |
| M5 | 审计日志 | `@primo512109/agentforge/audit` | ✅ 稳定 |
| M6 | 工具安全 | `@primo512109/agentforge/security` | ✅ 稳定 |
| M7 | 成本管控 | `@primo512109/agentforge/quota` | 🔧 部分接线 |
| M8 | 可观测性 | `@primo512109/agentforge/observability` | ✅ 稳定 |
| M9 | 优雅关闭 | `@primo512109/agentforge/lifecycle` | ✅ 稳定 |
| M10 | 结果校验 | `@primo512109/agentforge/validation` | ✅ 稳定 |

> 成熟度：✅ 稳定（完整接线+测试覆盖）| 🔧 开发中（部分接线/功能缺口）| 🔮 规划中

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
agent.run('Hello', {
  onToken: (delta) => process.stdout.write(delta),
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

编程式 API，提供完整的事件订阅和生命周期控制：

```typescript
import { createAgentLoop, ContextBuilder } from 'agentforge';

const ctx = new ContextBuilder()
  .withLLMAdapter(myLLMAdapter)
  .withToolRegistry(myToolRegistry)
  .build();

const loop = createAgentLoop(ctx, { maxSteps: 10 });

// 订阅特定事件类型
loop.on('llm.response', (event) => console.log('Response:', event.content));
loop.on('tool.result', (event) => console.log('Tool result:', event.result));

// 运行并获取输出
const output = await loop.run('Hello!');
console.log('Done:', output);

// 取消执行
loop.cancel();
```

## 核心概念

### 事件驱动架构

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   命令式循环 while(true) + await（非流驱动）                 │
│                                                             │
│   AgentEventEmitter 提供类型安全的事件分发                   │
│                                                             │
│   Hook 切面（RequestHook/ToolHook/LifecycleHook）替代流拦截  │
│                                                             │
│   Zod Schema 验证所有事件                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 事件类型

```typescript
// Layer 1: Core Agent Loop
'agent.start' | 'agent.step' | 'agent.complete' | 'agent.error' |
'llm.request' | 'llm.response' | 'llm.stream.text' |
'tool.call' | 'tool.execute' | 'tool.result' | 'tool.error' |
'hitl.ask' | 'hitl.answer' | 'checkpoint' | 'done' | 'cancel'

// Layer 2: Subsystem Lifecycle
'subagent.start' | 'subagent.complete' | 'subagent.error' |
'mcp.connected' | 'mcp.disconnected' |
'workflow.start' | 'workflow.complete' | 'workflow.error'
```

### Hook 系统

| Hook 类型 | 用途 |
|-----------|------|
| `RequestHook` | 在 LLM 调用前修改消息列表（替代 Interceptor 的事件修改能力） |
| `ToolHook` | 在工具执行前检查权限/阻断（替代 PermissionPlugin 的 EMPTY 阻断） |
| `LifecycleHook` | 在 Agent 生命周期关键点执行回调（session.start, step.begin, step.end 等） |
| `eventSubscriptions` | 通过 `AgentEventEmitter.on()` 纯观察事件，不阻塞主流程 |

## 示例

查看 [examples/](./examples/) 目录：

| 文件 | 内容 |
|------|------|
| [01-basic-usage.ts](./examples/01-basic-usage.ts) | L2/L3 API 基本使用 |
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
│   ├── events.ts   # AgentEventEmitter + Zod 事件 Schema
│   ├── state.ts    # AgentState 状态定义
│   ├── checkpoint.ts # 检查点系统
│   ├── hooks.ts    # HookRegistry（RequestHook/ToolHook/LifecycleHook）
│   ├── interfaces.ts # DI 接口定义
│   └── context-builder.ts # Context 构建器
├── loop/           # Agent 循环核心
│   ├── agent-loop.ts    # 命令式 while(true) 循环引擎
│   ├── token-budget.ts  # Token 预算管理
│   ├── error-analyzer.ts # 错误分析与恢复
│   └── tool-partition.ts # 工具并发安全分区
├── plugins/        # 插件系统
│   ├── plugin.ts   # Plugin 接口
│   ├── pipeline.ts # applyPlugins 入口
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

> 完整铁律体系（含分级和约束矩阵）见 [docs/design/00-OVERVIEW.md](./docs/design/00-OVERVIEW.md)

**架构层（5 条）**: A1 命令式循环 + 事件发射器 | A2 Harness 硬管控 | A3 Zod 分层数据契约 | A4 DI 解耦 | A5 三层 API

**运行时（6 条）**: R1 错误即事件不 throw | R2 Hook 异常隔离 | R3 工具必经注册表 | R4 主串行副并行 | R5 状态外部化可恢复 | R6 检查点声明式接线

**实现（4 条）**: I1 as any 零容忍 | I2 ESM 不含 RxJS | I3 外部输入不信任 | I4 测试即文档

### 三层 API

| 层次 | 目标用户 | 特点 |
|------|---------|------|
| **L1: 零代码** | 非程序员 | Markdown/JSON 配置文件 |
| **L2: 配置式** | 应用开发者 | `createAgent(config)` |
| **L3: 编程式** | 框架开发者 | 完全控制 AgentLoop + HookRegistry |

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

完整文档见 [docs/design/README.md](./docs/design/README.md)：

### 快速导航

| 分类 | 说明 | 链接 |
|------|------|------|
| **设计文档** | 核心架构设计 | [docs/design/](./docs/design/) |
| **分析文档** | 框架对比分析 | [docs/analysis/](./docs/analysis/) |
| **用户指南** | 快速上手指南 | [docs/guide/](./docs/guide/) |
| **API 参考** | 详细 API 说明 | [docs/api/](./docs/api/) |
| **开发计划** | 功能实现计划 | [docs/plans/](./docs/plans/) |
| **规格文档** | 设计规格规范 | [docs/specs/](./docs/specs/) |
| **项目管理** | 项目状态交接 | [docs/project/](./docs/project/) |

## License

MIT
