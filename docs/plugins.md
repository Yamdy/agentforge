# Plugin Development Guide

Plugins are the primary extension mechanism in AgentForge. A plugin is a factory function that receives a `HarnessAPI` and can register processors, hooks, tools, events, and resources.

## Plugin Interface

```typescript
type PluginFactory = (api: HarnessAPI) => PluginRegistration;

interface PluginRegistration {
  processors?: Processor[];
  tools?: ToolDefinition[];
  commands?: Record<string, (args: string) => Promise<void>>;
  compressionStrategy?: CompressionStrategy;
}
```

## HarnessAPI Methods

The `HarnessAPI` provides these registration methods:

| Method | Description |
|--------|-------------|
| `registerProcessor(stage, processor)` | Add a processor to a pipeline stage |
| `registerTool(tool)` | Register a tool available to the agent |
| `unregisterTool(name)` | Remove a previously registered tool |
| `registerHook(hook)` | Register a before/after hook |
| `subscribe(eventType, handler)` | Subscribe to an event (returns unsubscribe function) |
| `registerResource(declaration)` | Register a managed lifecycle resource |
| `registerProvider(name, factory)` | Register a model provider |
| `registerCompressionStrategy(strategy)` | Register a custom compression strategy |
| `emit(eventType, data)` | Emit an event to all subscribers |
| `insertStage(phase, after, newStage)` | Insert a new stage into the pipeline |
| `removeStage(phase, stage)` | Remove a stage from the pipeline |
| `replaceStages(phase, stages)` | Replace all stages in a pipeline phase |

## Writing a Plugin

### Basic Structure

```typescript
import type { HarnessAPI, PluginRegistration, PipelineContext } from '@primo-ai/sdk';

function myPlugin(api: HarnessAPI): PluginRegistration {
  // Register processors, hooks, tools, etc.

  return {
    // Optionally return processors and tools
  };
}
```

### Registering a Processor

Processors execute business logic at a specific pipeline stage:

#### v2 API (Recommended)

```typescript
api.registerProcessor('gateTool', {
  stage: 'gateTool',
  async executeV2(ctx) {
    // Access state directly
    const toolCalls = ctx.state.iteration.pendingToolCalls ?? [];

    // Flow control via ctx.control
    if (toolCalls.some(tc => dangerousTools.includes(tc.name))) {
      ctx.control.abort('Dangerous tool not allowed');
    }

    // In-place mutation (no return needed)
  },
});
```

**v2 API Benefits:**
- `ctx.state` provides mutable access to `PipelineContext`
- `ctx.control.abort(reason)` / `ctx.control.suspend(id)` for clean flow control
- Return `void` for in-place mutation, or return modified `PipelineContext`

#### v1 API (Deprecated)

```typescript
api.registerProcessor('processOutput', {
  stage: 'processOutput',
  async execute(ctx: PipelineContext) {
    console.log('Response length:', ctx.iteration.response?.length);
    return ctx;
  },
});
```

Available stages: `processInput`, `buildContext`, `prepareStep`, `gateLLM`, `invokeLLM`, `processStepOutput`, `gateTool`, `executeTools`, `evaluateIteration`, `processOutput`.

### Registering a Hook

Hooks intercept at fixed points without modifying pipeline flow:

```typescript
api.registerHook({
  point: 'llm.before',       // Hook point
  name: 'my-llm-logger',     // Optional name
  priority: 10,               // Lower runs first (default: 100)
  handler: (input, output) => {
    console.log('LLM call:', input.model);
  },
});
```

Hook points: `agent.start`, `agent.end`, `stage.before`, `stage.after`, `llm.before`, `llm.after`, `tool.before`, `tool.after`, `iteration.end`, `error`.

### Subscribing to Events

Events are non-intrusive side observations:

```typescript
const unsubscribe = api.subscribe('agent:start', (data) => {
  console.log('Agent started:', data);
});

// Call unsubscribe() to stop listening
```

### Registering a Resource

Resources have a managed lifecycle (started and stopped with the plugin):

```typescript
api.registerResource({
  id: 'my-database',
  type: 'service',
  config: { path: './data.db' },
  start: async () => {
    const connection = await connect('./data.db');
    return connection;
  },
  stop: async (instance) => {
    await instance.close();
  },
});
```

### Modifying the Pipeline

Plugins can dynamically modify the pipeline stage order:

```typescript
// Insert a custom stage after buildContext in the pre-loop phase
api.insertStage('preLoop', 'buildContext', 'myCustomStage');

// Register a processor for the custom stage
api.registerProcessor('myCustomStage', {
  stage: 'myCustomStage',
  execute: async (ctx) => {
    // Custom logic
    return ctx;
  },
});
```

## Plugin Lifecycle

1. **Construction** -- Plugin factory function is called with `HarnessAPI`
2. **Registration** -- Plugin registers processors, hooks, tools, resources
3. **Initialization** -- `pluginManager.initializeAll()` starts all resources
4. **Execution** -- Processors and hooks execute during agent runs
5. **Shutdown** -- `pluginManager.shutdown()` stops all resources

## Using Plugins

```typescript
import { Agent } from '@primo-ai/core';

const agent = new Agent({ model: 'deepseek/deepseek-v4-flash' });

// Register a plugin
agent.use(myPlugin);

// Initialize all plugins (starts resources)
await agent.pluginManager.initializeAll();

// Run the agent (plugins are active)
const result = await agent.run('Hello');

// Shutdown when done (stops resources)
await agent.pluginManager.shutdown();
```

## Flow Control (v2 API)

### Aborting the Pipeline

Processors can abort the pipeline with an optional retry point:

```typescript
api.registerProcessor('gateLLM', {
  stage: 'gateLLM',
  async executeV2(ctx) {
    const usage = ctx.state.session.totalTokenUsage;
    if (usage && usage.input > 100000) {
      ctx.control.abort('Token budget exceeded', 'buildContext');
    }
  },
});
```

### Suspending the Pipeline

Processors can suspend for human-in-the-loop workflows:

```typescript
import { randomUUID } from 'node:crypto';

api.registerProcessor('gateTool', {
  stage: 'gateTool',
  async executeV2(ctx) {
    const toolCall = ctx.state.iteration.pendingToolCalls?.[0];
    if (toolCall?.name === 'dangerous_action') {
      ctx.control.suspend(randomUUID());
    }
  },
});
```

## Using Adapters

For common patterns, use the high-level adapter APIs:

```typescript
import { modifiers, gates } from '@primo-ai/core';

// Simple context modification
api.registerProcessor('invokeLLM', modifiers.message((msgs, ctx) => [
  { role: 'user', content: 'System context...' },
  ...msgs,
]));

// Permission gate
api.registerProcessor('gateTool', gates.permission({
  check: (toolName) => dangerousTools.includes(toolName) ? 'ask' : 'allow',
}));
```

## Legacy: Returning Signals (v1 API, Deprecated)
```

## Compression Plugin -- Built-in SummarizeFn

`compressionPlugin` 的 `summarize` phase 支持自定义摘要函数。

### SummarizeFn 类型

```typescript
type SummarizeFn = (messages: Message[]) => Promise<string>;
```

### createSummarizeFn

内置工厂函数，通过 LLM 调用生成摘要：

```typescript
import { createSummarizeFn } from '@primo-ai/plugins';

const fn = createSummarizeFn(
  (model) => ({ invoke: async (input) => ({ response: 'summary', tokenUsage: null }) }),
  'deepseek/deepseek-v4-flash',  // 可选 model 参数
);
```

`createSummarizeFn` 使用内置 system prompt 指导 LLM 生成结构化、保留关键信息的对话摘要。支持多语言（中文、日文等）。

### 在 compressionPlugin 中使用

```typescript
agent.use(compressionPlugin({
  maxContextTokens: 8000,
  phases: [
    { type: 'summarize', model: 'gpt-4o', maxTokens: 2000, summarizeFn: customFn },
  ],
  // 自动注入：提供 getLLM 即可自动为所有 summarize phase 创建 summarizeFn
  getLLM: (model) => llmInvoker,
  summarizeModel: 'deepseek/deepseek-v4-flash',
}));
```

当提供 `getLLM` 时，插件自动调用 `createSummarizeFn(getLLM, summarizeModel)` 为所有缺少 `summarizeFn` 的 summarize phase 注入默认实现。
