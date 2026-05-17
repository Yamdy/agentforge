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
import type { HarnessAPI, PluginRegistration, PipelineContext } from '@agentforge/sdk';

function myPlugin(api: HarnessAPI): PluginRegistration {
  // Register processors, hooks, tools, etc.

  return {
    // Optionally return processors and tools
  };
}
```

### Registering a Processor

Processors execute business logic at a specific pipeline stage:

```typescript
api.registerProcessor('processOutput', {
  stage: 'processOutput',
  execute: async (ctx: PipelineContext) => {
    // Transform the context
    console.log('Response length:', ctx.iteration.response?.length);
    return ctx;  // Must return PipelineContext, AbortSignal, or SuspensionSignal
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
import { Agent } from '@agentforge/core';

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

## Returning AbortSignal

Processors can abort the pipeline with an optional retry point:

```typescript
api.registerProcessor('gateLLM', {
  stage: 'gateLLM',
  execute: async (ctx) => {
    if (ctx.session.totalTokenUsage && ctx.session.totalTokenUsage.input > 100000) {
      return {
        type: 'abort',
        reason: 'Token budget exceeded',
        retryFrom: 'buildContext',  // Optional: retry from this stage
      };
    }
    return ctx;
  },
});
```

## Returning SuspensionSignal

Processors can suspend the pipeline for human-in-the-loop workflows:

```typescript
import { serialize } from '@agentforge/core';

api.registerProcessor('gateTool', {
  stage: 'gateTool',
  execute: async (ctx) => {
    const toolCall = ctx.iteration.pendingToolCalls?.[0];
    if (toolCall?.name === 'dangerous_action') {
      return {
        type: 'suspend',
        suspensionId: crypto.randomUUID(),
        reason: 'Requires human approval for: ' + toolCall.name,
        checkpoint: {
          context: ctx,
          nextStages: ['executeTools'],
          iteration: ctx.iteration.step,
        },
      };
    }
    return ctx;
  },
});
```
