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
| `AgentForgeError` | Base error class with domain hierarchy |

## Dependencies

- `@primo-ai/sdk` -- type definitions
- `@primo-ai/observability` -- tracing and metrics
- `@primo-ai/tools` -- built-in tools
- `ai` + provider SDKs -- Vercel AI SDK core
