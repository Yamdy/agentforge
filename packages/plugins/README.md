# @primo-ai/plugins

Built-in processor plugins for the AgentForge pipeline.

## Overview

Plugins extend the agent pipeline by registering processors, hooks, tools, and resources. Each plugin is a factory function that receives a `HarnessAPI` and returns a `PluginRegistration`.

## Usage

```typescript
import { Agent } from '@primo-ai/core';
import { memoryPlugin, InMemoryBackend } from '@primo-ai/plugins';

const agent = new Agent({ model: 'deepseek/deepseek-v4-flash' });
agent.use(memoryPlugin({ backend: new InMemoryBackend() }));
```

## Plugin Catalog

### Core Plugins

| Plugin | Factory | Description |
|--------|---------|-------------|
| **memory** | `memoryPlugin(options)` | Persistent memory with search/recall across sessions |
| **compression** | `compressionPlugin(options)` | Context window management via truncation/summarization |
| **permission** | `permissionPlugin(options)` | Tool access control with allow/deny/ask rules |
| **skill** | `skillPlugin(options)` | Dynamic skill injection from definitions or filesystem |
| **mcp** | `mcpPlugin(options)` | Model Context Protocol tool discovery and execution |
| **eviction** | `evictionPlugin(options)` | Automatic long-term memory eviction when context grows |
| **outputValidation** | `createOutputValidationProcessor(config)` | Validates LLM output against configurable strategies |

### Harness Plugins

| Plugin | Factory | Description |
|--------|---------|-------------|
| **factInjection** | `createFactInjectionProcessor(config)` | Injects static or dynamic facts into context |
| **goalEcho** | `createGoalEchoProcessor(config)` | Periodically echoes the agent's goal to maintain focus |
| **tokenBudget** | `createTokenBudgetProcessor(config)` | Enforces token budget limits with compress/truncate/block |
| **costCap** | `createCostCapProcessor(config)` | Enforces cost limits with model-specific pricing |
| **rateLimit** | `createRateLimitProcessor(config)` | Rate-limits LLM calls per time window |

## Plugin Configuration

### memory

```typescript
memoryPlugin({
  backend: new InMemoryBackend(),        // or new SQLiteBackend('./data.db')
  triggerMode: { type: 'automatic', onLoad: 'always' },
})
```

### compression

```typescript
compressionPlugin({
  maxContextTokens: 8000,
  phases: [
    { type: 'truncate', maxLength: 500 },
  ],
})
```

### permission

```typescript
permissionPlugin({
  mode: 'full-auto',                     // or 'interactive'
  rules: [
    { tool: 'getWeather', action: 'allow' },
    { tool: 'shell_exec', action: 'ask' },  // requires approval
  ],
})
```

### skill

```typescript
skillPlugin({
  skills: [
    { name: 'summarize', description: 'Summarize text', content: '...' },
  ],
})
```

### mcp

```typescript
mcpPlugin({
  servers: [
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'node',
      args: ['path/to/mcp-server.js', '/data'],
    },
  ],
})
```

### eviction

```typescript
evictionPlugin({
  maxSize: 500,
  storage: new InMemoryEvictionStorage(),  // or new FilesystemEvictionStorage({ dir: './evicted' })
})
```

## Writing a Custom Plugin

```typescript
import type { HarnessAPI, PluginRegistration } from '@primo-ai/sdk';

function myPlugin(api: HarnessAPI): PluginRegistration {
  // Register a processor on a pipeline stage
  api.registerProcessor('buildContext', {
    stage: 'buildContext',
    execute: async (ctx) => {
      // Modify context and return it
      return ctx;
    },
  });

  // Register a hook
  api.registerHook({
    point: 'llm.before',
    handler: (input, output) => {
      console.log('LLM call about to happen');
    },
  });

  // Subscribe to events
  api.subscribe('agent:start', (data) => {
    console.log('Agent started:', data);
  });

  return {}; // Optionally return processors, tools, commands
}

// Usage: agent.use(myPlugin);
```

## Dependencies

- `@primo-ai/sdk` -- type definitions
- `@primo-ai/core` -- plugin harness API
