# AgentForge

**TypeScript Agent framework where Pipeline is everything.**

Every pipeline stage is simultaneously an extension point, an observability span, and a hook interception point. 8 built-in stages, 15+ plugins, any LLM provider.

[![npm version](https://img.shields.io/npm/v/@agentforge/core?label=%40agentforge%2Fcore)](https://www.npmjs.com/package/@agentforge/core)
[![MIT License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## Quick Start

```bash
npm install @agentforge/core
```

```typescript
import { Agent, registerProvider } from '@agentforge/core';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Register any OpenAI-compatible provider
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

const { response } = await agent.run('Hello!');
console.log(response);
```

## Why AgentForge?

| What you need | How AgentForge does it | Others |
|---|---|---|
| Observe & control every stage | Each stage = Processor + Span + Hook (three-in-one) | Middleware or callbacks only |
| Production-grade guardrails | Built-in costCap, tokenBudget, rateLimit, permission plugins | Roll your own |
| Agent-to-Agent communication | Native A2A protocol with streaming | Single-agent only |
| Interrupt & resume sessions | suspend/resume + checkpoint + JSONL persistence | Not supported |
| Composable plugins | 15+ built-in, one function to register | Manual integration |

## Progressive Examples

### Observe pipeline events

Every stage emits events you can subscribe to -- no setup required.

```typescript
agent.events.subscribe('invokeLLM:after', (data) => {
  console.log('LLM call complete', data);
});
```

### Add plugins

Swap in production plugins with one line each.

```typescript
import { memoryPlugin, compressionPlugin, permissionPlugin } from '@agentforge/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
  maxIterations: 10,
  plugins: [
    memoryPlugin({ backend: 'sqlite' }),
    compressionPlugin({ maxTokens: 8000 }),
    permissionPlugin({ mode: 'interactive' }),
  ],
});
```

### Multi-agent via A2A

Two agents talking to each other over the Agent-to-Agent protocol.

```typescript
import { AgentForgeServer, A2AClient, a2aRoutes } from '@agentforge/server';

// Start a researcher agent on port 3001
const server = new AgentForgeServer({ port: 3001 });
server.registry.register('researcher', {
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a research assistant.',
  maxIterations: 2,
});
server.hono.route('/a2a', a2aRoutes({ registry: server.registry, agentId: 'researcher' }));
await server.start();

// Send a task from another agent
const client = new A2AClient({ card: { name: 'researcher', url: 'http://localhost:3001/a2a' } });
const result = await client.sendMessage('Summarize neural networks in 2 sentences.');
```

### Custom processor

Write your own pipeline stage in 10 lines.

```typescript
import { createFactInjectionProcessor } from '@agentforge/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
  plugins: [
    {
      name: 'inject-time',
      processors: [
        {
          stage: 'buildContext',
          processor: createFactInjectionProcessor({
            facts: { currentTime: () => new Date().toISOString() },
          }),
        },
      ],
    },
  ],
});
```

## Architecture

### Pipeline stages

```
processInput -> buildContext -> [Agentic Loop:
  prepareStep -> gateLLM -> invokeLLM -> processStepOutput -> gateTool -> executeTools -> evaluateIteration
] -> processOutput
```

The loop repeats until `iteration.loopDirective` is `stop`. Any processor can return an `AbortSignal` to abort with optional `retryFrom` a specific stage.

### Pipeline context

Every stage receives a `PipelineContext` with four regions:

| Region | Purpose | Contents |
|--------|---------|----------|
| `request` | Immutable input | user message, sessionId |
| `agent` | Configuration | model, systemPrompt, tools, promptFragments |
| `iteration` | Per-step state | step number, response, loopDirective, span |
| `session` | Cross-iteration state | messageHistory, tokenUsage, plugin custom data |

### Packages

```
packages/
  sdk/             -- Pure type definitions
  tools/           -- Built-in tool implementations
  observability/   -- Span, Tracer, Metrics + OpenTelemetry bridge
  core/            -- Agent, PipelineRunner, LLMInvoker, ToolRegistry, SessionManager
  plugins/         -- 15+ processor plugins
  server/          -- Hono HTTP server, WebSocket, A2A protocol, CLI
```

Dependency flow: `sdk` <- `tools` / `observability` <- `core` <- `plugins` <- `server`.

## Production

### Configuration

Multi-level JSONC config (highest priority first):

1. **Session-level** -- runtime params passed to `agent.run()`
2. **Project-level** -- `.agentforge/config.jsonc`
3. **Global-level** -- `~/.agentforge/config.jsonc`

```jsonc
// .agentforge/config.jsonc
{
  "agents": {
    "assistant": {
      "model": "deepseek/deepseek-v4-flash",
      "systemPrompt": "You are a helpful assistant.",
      "maxIterations": 5
    }
  }
}
```

### CLI

```bash
npx agentforge serve --port 3000 --api-key secret   # Start server
npx agentforge run --agent assistant --input "Hello" # Single invocation
npx agentforge dev --config .agentforge/config.jsonc # Dev mode with watch
```

### API endpoints

```
GET  /health/live     -- Liveness probe
GET  /health/ready    -- Readiness probe
POST /agents/:id/run  -- Run an agent
GET  /agents/:id/stream -- Stream agent output (SSE)
GET  /sessions        -- List sessions
```

### Docker

```bash
docker compose up
```

Container exposes port 3000 with health checks. Mount your config at `/app/.agentforge/`.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for development commands and architecture details.

## License

MIT
