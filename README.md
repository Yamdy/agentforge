# AgentForge

A TypeScript agent framework built around a **Processor Pipeline** model. Every stage of the agent lifecycle is simultaneously an extension point, an observability span, and a hook interception point.

## Features

- **Pipeline Architecture** -- 10-stage agent lifecycle with per-stage processors, hooks, and spans
- **7 Core Modules** -- PipelineRunner, ContextBuilder, LLMInvoker, ToolRegistry, EventSystem, HookManager, CheckpointStore
- **Plugin System** -- 14 built-in plugins (memory, compression, permission, skill, MCP, eviction, costCap, factInjection, goalEcho, moderation, pii, tokenBudget, rateLimit, outputValidation)
- **Multi-Provider** -- OpenAI, Anthropic, Google, DeepSeek, and custom OpenAI-compatible endpoints
- **A2A Protocol** -- Agent-to-Agent JSON-RPC protocol with streaming support
- **Session Persistence** -- JSONL storage with suspend/resume and checkpoint recovery
- **Streaming** -- Token-by-token streaming via async generators

## Quick Start

### Install

```bash
pnpm install
pnpm build
```

### Minimal Example

```typescript
import { Agent, registerProvider } from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Register a provider
registerProvider('deepseek', (modelId) => {
  const sdk = createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY!,
  });
  return sdk.languageModel(modelId);
});

// Create and run an agent
const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
  maxIterations: 5,
});

const result = await agent.run('Hello, how are you?');
console.log(result.response);
```

## Architecture

### Pipeline Stages

```
processInput -> buildContext -> [Agentic Loop:
  prepareStep -> gateLLM -> invokeLLM -> processStepOutput -> gateTool -> executeTools -> evaluateIteration
] -> processOutput
```

The agentic loop repeats until `iteration.loopDirective` is `stop`. Processors can return an `AbortSignal` to abort with optional `retryFrom` a specific stage.

### Package Structure

```
packages/
  sdk/             -- Pure type definitions (PipelineContext, Processor, Tool, Span, etc.)
  tools/           -- Built-in tool implementations (echo, etc.)
  observability/   -- Span, Tracer, Metrics abstractions + OpenTelemetry bridge
  core/            -- Agent, PipelineRunner, LLMInvoker, ToolRegistry, SessionManager
  plugins/         -- Processor plugins (memory, compression, permission, skill, MCP, eviction)
  server/          -- Hono HTTP server, WebSocket bridge, A2A protocol, CLI
```

Dependency direction: `sdk` (zero deps) <-- `tools` / `observability` <-- `core` <-- `plugins` <-- `server`.

### Pipeline Context

Every stage receives a `PipelineContext` with four regions:

| Region | Purpose | Contents |
|--------|---------|----------|
| `request` | Immutable input | user message, sessionId |
| `agent` | Configuration | model, systemPrompt, tools, promptFragments |
| `iteration` | Per-step state | step number, response, loopDirective, span |
| `session` | Cross-iteration state | messageHistory, tokenUsage, plugin custom data |

## Configuration

AgentForge uses multi-level JSONC configuration (highest priority first):

1. **Session-level** -- runtime params passed to `agent.run()`
2. **Project-level** -- `.agentforge/config.jsonc`
3. **Global-level** -- `~/.agentforge/config.jsonc`
4. **Environment** -- `AGENTFORGE_CONFIG` env var

Example `.agentforge/config.jsonc`:

```jsonc
{
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are a helpful assistant.",
      "maxIterations": 5
    }
  },
  "modelGateways": [
    { "name": "my-llm", "url": "https://api.example.com/v1" }
  ]
}
```

## CLI Usage

```bash
# Start server
npx agentforge serve --port 3000 --api-key secret

# Run a single agent invocation
npx agentforge run --agent assistant --input "Hello"

# Dev mode with file watching
npx agentforge dev --config .agentforge/config.jsonc
```

## API Server

AgentForge includes an HTTP server with agent endpoints, session management, and health checks:

```
GET  /health/live          -- Liveness probe
GET  /health/ready         -- Readiness probe
POST /agents/:id/run       -- Run an agent
GET  /agents/:id/stream    -- Stream agent output (SSE)
GET  /sessions              -- List sessions
```

## Docker

```bash
docker compose up
```

The container exposes port 3000 with health checks configured. Mount your config at `/app/.agentforge/`.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development commands and architecture details.

## License

MIT
