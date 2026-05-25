# @primo-ai/core

Core agent loop, processor pipeline, and orchestration layer.

## Overview

This package provides the main building blocks of the AgentForge framework:

- **Agent** -- Top-level facade for creating, configuring, and running agents
- **PipelineRunner** -- Executes the linear pipeline of processors stage by stage
- **LoopOrchestrator** -- Manages the agentic loop (repeating stages until stop)
- **LLMInvoker** -- Wraps Vercel AI SDK `streamText()` for single-step LLM calls
- **ToolRegistry** -- Registers tools and converts them to AI SDK schemas
- **EventBus / EventSystem** -- Pub/sub event dispatch with replay support
- **HookManager** -- Fixed-point interception (before/after hooks)
- **StateMachine** -- Agent lifecycle states (pending/running/completed/paused/cancelled/error)
- **ModelFactory** -- Canonical model resolution with pluggable gateways
- **ContextBuilder** -- Assembles PipelineContext from config, tools, and prompt fragments
- **Adapters** -- High-level APIs for common processor patterns (modifiers, gates)

## Quick Example

```typescript
import { Agent, registerProvider } from '@primo-ai/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY!,
  });
  return sdk.languageModel(modelId);
});

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
  maxIterations: 5,
});

// Run (returns full result)
const result = await agent.run('Hello');
console.log(result.response, result.tokenUsage, result.sessionId);

// Stream (yields text chunks)
for await (const chunk of agent.stream('Hello')) {
  process.stdout.write(chunk);
}
```

## Agent API

### `new Agent(config, deps?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.model` | `string` | Model string in `provider/modelId` format |
| `config.systemPrompt` | `Dynamic<string>` | System prompt (static or per-request function) |
| `config.maxIterations` | `Dynamic<number>` | Max agentic loop iterations (default: 10) |
| `config.tools` | `Tool[]` | Tools available to the agent |
| `config.providerOptions` | `Record<string, Record<string, unknown>>` | Per-provider options passed to streamText() |

### `agent.run(input, signal?)` -> `Promise<AgentRunResult>`

Runs the agent pipeline to completion. Returns `{ response, tokenUsage, sessionId, compatRetries }`.

### `agent.stream(input, signal?)` -> `AsyncGenerator<string>`

Streams text chunks as the agent generates them.

### `agent.streamEvents(input, signal?)` -> `AsyncGenerator<StreamEvent>`

Streams structured events (text_delta, tool_call, tool_result, stage_start, etc.).

### `agent.resume(sessionId, signal?)` -> `Promise<AgentRunResult>`

Resumes a suspended agent from a checkpoint.

### `agent.use(factory)`

Registers a plugin or processor. Accepts a `PluginFactory` function or a `Processor` instance.

## Key Exports

| Export | Description |
|--------|-------------|
| `PipelineRunner` | Executes pipeline stages sequentially |
| `LoopOrchestrator` | Manages agentic loop with abort/retry/suspend |
| `LLMInvoker` | Single-step LLM invocation via AI SDK |
| `ToolRegistry` | Tool registration and schema conversion |
| `EventBus` | Lightweight pub/sub event bus |
| `EventSystem` | Event dispatch with replay backend |
| `HookManager` | Before/after hook invocation |
| `StateMachine` | Agent lifecycle state transitions |
| `ModelFactory` | Pluggable model resolution chain |
| `ContextBuilder` | PipelineContext assembly |
| `PluginManager` | Plugin lifecycle (initialize, shutdown) |
| `SessionManagerImpl` | Session CRUD with suspend/resume |
| `FilesystemSessionStorage` | JSONL file-based session storage |
| `createSubAgentTool` | Creates a tool that delegates to a sub-agent |
| `ConcurrencyController` | Limits parallel task execution |
| `TaskManagerImpl` | Async sub-agent task management |
| `ConfigLoader` | Multi-layer JSONC config loading |
| `InMemoryCheckpointStore` | In-memory checkpoint storage |
| `JsonlCheckpointStore` | JSONL file-based checkpoint storage |
| `serialize` / `deserialize` | PipelineContext serialization for checkpoints |
| `registerProvider` | Register a model provider factory |
| `AgentForgeError` | Base error class with domain hierarchy, `retryHint` for recovery guidance |
| `modifiers` | High-level processor factories for context mutation |
| `gates` | High-level processor factories for flow control |
| `AbortControlFlow` | Control flow error for abort |
| `SuspendControlFlow` | Control flow error for suspend |

## Processor API

Processors implement a single, clean API:

```typescript
import type { Processor, ProcessorContext } from '@primo-ai/sdk';

const myProcessor: Processor = {
  stage: 'gateTool',
  async execute(ctx: ProcessorContext) {
    // Access state directly
    const toolCalls = ctx.state.iteration.pendingToolCalls ?? [];

    // Flow control via ctx.control
    if (toolCalls.some(tc => tc.name === 'dangerous')) {
      ctx.control.abort('Dangerous tool not allowed');
    }

    // In-place mutation (no return needed)
    ctx.state.session.messageHistory = [...];
  },
};
```

**Key features:**
- `ctx.state` provides mutable access to `PipelineContext`
- `ctx.control.abort(reason)` / `ctx.control.suspend(id)` for flow control (throws special error)
- Return `void` for in-place mutation, or return modified `PipelineContext`
- No need to return signal objects manually

## Adapters API

High-level factories for common processor patterns:

### Modifiers

Simple context mutation:

```typescript
import { modifiers } from '@primo-ai/core';

// Modify message history
const addContext = modifiers.message((msgs, ctx) => [
  { role: 'user', content: `Context: ${ctx.request.metadata.context}` },
  ...msgs,
]);

// Modify system prompt
const addTimestamp = modifiers.systemPrompt((prompt, ctx) =>
  `${prompt}\n\nCurrent time: ${new Date().toISOString()}`
);

// Modify tools
const addAdminTools = modifiers.tools((tools, ctx) =>
  ctx.request.metadata.isAdmin ? [...tools, adminTool] : tools
);

// Modify provider options
const setTemperature = modifiers.providerOptions((opts, ctx) => ({
  ...opts,
  openai: { temperature: 0.7 },
}));
```

### Gates

Flow control (abort/suspend):

```typescript
import { gates } from '@primo-ai/core';

// Permission gate
const permissionGate = gates.permission({
  check: (toolName, args, ctx) => {
    if (dangerousTools.includes(toolName)) return 'ask';
    if (blockedTools.includes(toolName)) return 'deny';
    return 'allow';
  },
  onDeny: (toolName) => `Tool '${toolName}' is not allowed`,
});

// Token quota gate
const quotaGate = gates.quota({
  check: (usage, ctx) => !usage || usage.input + usage.output < 10000,
  onExceeded: (usage) => `Token quota exceeded: ${usage?.input ?? 0} tokens`,
});

// Cost gate
const costGate = gates.cost({
  maxCost: 1.0, // $1 max
  calculateCost: (usage, model) => {
    const rates = { 'gpt-4': { input: 0.03, output: 0.06 } };
    const r = rates[model] ?? { input: 0.001, output: 0.002 };
    return (usage.input * r.input + usage.output * r.output) / 1000;
  },
});
```

## Dependencies

- `@primo-ai/sdk` -- type definitions
- `@primo-ai/observability` -- tracing and metrics
- `@primo-ai/tools` -- built-in tools
- `ai` + provider SDKs -- Vercel AI SDK core
