# Migration Guide

从 AgentForge 早期版本迁移到当前 Processor Pipeline 架构的指南。

---

## 概览

当前架构经过多次重大重构，核心变更包括：

| 变更 | ADR | 影响范围 |
|------|-----|---------|
| 四区域 PipelineContext | ADR-0007 | 所有 Processor 和 Plugin |
| Hook + EventBus 系统 | ADR-0007 | 跨切面逻辑 |
| Dynamic 配置 | ADR-0008 | AgentConfig 字段 |
| Gateway 链模型路由 | ADR-0008 | 模型解析 |
| Processor 模块化 | 架构升级 | Agent 内部结构 |
| Provider 兼容层 | P3/P4 | LLM 调用 |

---

## 1. `pipeline: Record<string, unknown>` → 四区域 PipelineContext

**之前**: 使用无类型的 `pipeline` 字段传递状态

```ts
// 旧模式
ctx.pipeline.textStream = stream;
ctx.pipeline.response = text;
ctx.pipeline.myPluginData = { ... };
```

**现在**: 使用四个类型化区域

```ts
// 新模式
ctx.iteration.fullStream = stream;
ctx.iteration.response = text;
ctx.session.custom.myPluginData = { ... };
```

### 迁移映射

| 旧位置 | 新位置 |
|--------|--------|
| `ctx.pipeline.userInput` | `ctx.request.input` |
| `ctx.pipeline.sessionId` | `ctx.request.sessionId` |
| `ctx.pipeline.config` | `ctx.agent.config` |
| `ctx.pipeline.systemPrompt` | `ctx.agent.systemPrompt` |
| `ctx.pipeline.tools` | `ctx.agent.toolDeclarations` |
| `ctx.pipeline.step` | `ctx.iteration.step` |
| `ctx.pipeline.textStream` | `ctx.iteration.fullStream` |
| `ctx.pipeline.response` | `ctx.iteration.response` |
| `ctx.pipeline.toolCalls` | `ctx.iteration.pendingToolCalls` |
| `ctx.pipeline.stopLoop` | `ctx.iteration.loopDirective = { action: 'stop' }` |
| `ctx.pipeline.messageHistory` | `ctx.session.messageHistory` |
| `ctx.pipeline.tokenUsage` | `ctx.session.totalTokenUsage` |
| `ctx.pipeline.*` (插件数据) | `ctx.session.custom.*` |

---

## 2. `stopLoop: boolean` → `LoopDirective`

**之前**: 布尔标志控制循环

```ts
// 旧模式
ctx.pipeline.stopLoop = true;
ctx.pipeline.retryFrom = 'buildContext';
```

**现在**: 结构化指令

```ts
// 新模式
ctx.iteration.loopDirective = { action: 'stop' };
ctx.iteration.loopDirective = { action: 'continue' };
ctx.iteration.loopDirective = { action: 'retry', retryFrom: 'buildContext' };
```

---

## 3. `PROVIDER_MAP` → GatewayChain

**之前**: 硬编码的 provider 映射

```ts
// 旧模式 — 直接 PROVIDER_MAP
const model = PROVIDER_MAP['openai']('gpt-4o');
```

**现在**: 可插拔的 Gateway 链

```ts
// 新模式 — GatewayChain
import { GatewayChain, BuiltInGateway } from '@agentforge/core';
import { OpenAICompatibleGateway } from '@agentforge/core';

const chain = new GatewayChain();
chain.register(new OpenAICompatibleGateway({
  name: 'my-custom',
  url: 'https://api.example.com/v1',
}));
chain.register(new BuiltInGateway());

// resolveModel 内部使用 GatewayChain
```

`registerProvider()` 仍然可用，作为向后兼容的简写：

```ts
registerProvider('custom', (modelId) => factory(modelId));
```

---

## 4. Agent 内联逻辑 → Processor 模块化

**之前**: Agent 类包含所有业务逻辑

```ts
// 旧模式 — 逻辑内联在 Agent 类中
class Agent {
  async processInput() { /* ... */ }
  async buildContext() { /* ... */ }
  async invokeLLM() { /* ... */ }
  // 1000+ 行...
}
```

**现在**: 8 个独立 Processor 模块

```ts
// 新模式 — 工厂函数创建的独立 Processor
import { processInputProcessor } from '@agentforge/core/processors/process-input';
import { createBuildContextProcessor } from '@agentforge/core/processors/build-context';
import { createInvokeLLMProcessor } from '@agentforge/core/processors/invoke-llm';
```

Agent 变为纯编排器，组合 Processor 并管理生命周期。自定义逻辑通过 `PipelineRunner.register()` 或 Plugin 注入。

---

## 5. 静态配置 → Dynamic 配置

**之前**: 所有配置为静态值

```ts
// 旧模式
const agent = new Agent({
  model: 'openai/gpt-4o',
  systemPrompt: '你是助手',
  maxIterations: 5,
});
```

**现在**: `systemPrompt` 和 `maxIterations` 支持 `Dynamic<T>`

```ts
// 新模式 — 静态值仍然有效
const agent = new Agent({
  model: 'openai/gpt-4o',
  systemPrompt: '你是助手',        // 静态 string ✓
  maxIterations: 5,                // 静态 number ✓
});

// 或动态值
const agent = new Agent({
  model: 'openai/gpt-4o',
  systemPrompt: (ctx) => `你好，${ctx.input}`,
  maxIterations: (ctx) => isComplex(ctx.input) ? 10 : 3,
});
```

静态值无需修改即可继续使用。

---

## 6. 直接事件 Map → EventBus + Hook 双系统

**之前**: `Map<string, handler[]>` 处理所有事件

```ts
// 旧模式
pluginManager.on('tool:call', handler);
pluginManager.emit('tool:call', data);
```

**现在**: 两个独立系统

```ts
// Hook — 执行路径上，可修改数据
harness.registerHook({
  point: 'tool.before',
  handler: (ctx) => { /* 修改/检查 */ },
  priority: 10,
});

// EventBus — 解耦广播
bus.subscribe('tool:call', (data) => { /* 监听/记录 */ });
bus.emit('tool:call', data);
```

**何时用 Hook**: 需要修改数据、中断流程（如权限检查）
**何时用 EventBus**: 需要解耦监听（如日志、持久化、监控）

---

## 7. 新增: Provider 兼容层

当前版本引入了 `ProviderCapabilities` 和 `CompatRule` 引擎，自动处理不同 LLM Provider 的差异：

- 自动检测 Provider 能力（推理、工具调用、并行工具调用等）
- 抢占式规则在发送前重写消息（如 Anthropic 要求交替角色）
- 响应式规则在 API 错误后修复历史（如 DeepSeek 要求 reasoningContent）

内置 6 条规则，通常无需手动干预。如需自定义：

```ts
import { applyPreemptiveRules, applyReactiveRules } from '@agentforge/core';

// 自定义 CompatRule
const myRule: CompatRule = {
  name: 'my-custom-rule',
  providers: ['my-provider'],
  applyToPrompt: (messages, caps) => {
    // 修改 messages
    return messages;
  },
};
```

---

## 8. 新增: Model Profile

按模型定制行为，无需修改全局配置：

```ts
import { matchProfile, applyProfile } from '@agentforge/core';

const profiles: ModelProfile[] = [{
  modelPattern: 'deepseek/*',
  systemPromptSuffix: '\n注意：你是 DeepSeek 模型。',
  toolOverrides: {
    shell_exec: { exclude: true },
  },
}];

const profile = matchProfile('deepseek/deepseek-v4-flash', profiles);
if (profile) {
  ctx = applyProfile(ctx, profile);
}
```

---

## 9. 配置系统变更

**之前**: 可能使用 `.env` 或硬编码配置

**现在**: 多层 JSONC 配置合并

```
优先级（高 → 低）：
1. Session-level — agent.run() 传入的参数
2. Project-level — .agentforge/config.jsonc
3. Global-level — ~/.agentforge/config.jsonc
4. Environment — AGENTFORGE_CONFIG 环境变量
```

```ts
import { ConfigLoader } from '@agentforge/core';

const loader = new ConfigLoader();
const config = await loader.load({
  env: 'AGENTFORGE_CONFIG',
  project: '.agentforge/config.jsonc',
  global: '~/.agentforge/config.jsonc',
});
```

---

## 10. 完整迁移示例

### 旧版 Agent 创建

```ts
// 旧模式
const agent = new Agent({
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: '你是助手',
  maxSteps: 10,
  tools: [myTool],
});

agent.on('response', (text) => console.log(text));
const result = await agent.chat('你好');
```

### 当前版本等价写法

```ts
// 新模式
import { Agent, registerProvider, EventBus } from '@agentforge/core';
import { OTelBridge } from '@agentforge/observability';

// 1. Provider 注册
registerProvider('openai', (modelId) => {
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).languageModel(modelId);
});

// 2. 创建 Agent
const bus = new EventBus();
const agent = new Agent({
  model: 'openai/gpt-4o',
  systemPrompt: '你是助手',
  maxIterations: 10,
  tools: [myTool],
});

// 3. 事件监听（替代旧的 .on()）
bus.subscribe('agent:end', (data) => {
  console.log(data.response);
});

// 4. 运行（流式）
for await (const event of agent.stream('你好')) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.text);
  }
}

// 或同步
const result = await agent.run('你好');
```

---

## 常见问题

### Q: 旧的 `registerProvider()` 还能用吗？

可以。`registerProvider()` 作为向后兼容接口保留，内部注册到 `BuiltInGateway`。

### Q: Plugin 接口有变化吗？

Plugin 工厂签名不变：`(harness: HarnessAPI) => PluginRegistration`。但 Processor 内部访问 context 的方式需要迁移到四区域模型。

### Q: 是否需要一次性迁移所有代码？

不需要。建议按以下顺序逐步迁移：

1. **模型字符串** — 添加 provider 前缀 (`"gpt-4o"` → `"openai/gpt-4o"`)
2. **AgentConfig** — 确认 `maxSteps` → `maxIterations`
3. **Plugin Processor** — 迁移 `ctx.pipeline.*` 到四区域
4. **事件监听** — 迁移到 EventBus + Hook
5. **配置系统** — 迁移到 JSONC 多层配置

### Q: 测试需要怎么改？

使用四区域类型构造 `PipelineContext`：

```ts
const ctx: PipelineContext = {
  request: { input: 'test', sessionId: 'test-session' },
  agent: { config, toolDeclarations: [], promptFragments: [] },
  iteration: { step: 1 },
  session: { custom: {} },
};

const result = await processor.execute(ctx);
expect(result.iteration.loopDirective?.action).toBe('stop');
```
