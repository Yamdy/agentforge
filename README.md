<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="agentforge-logo-v4.jpg">
    <img src="agentforge-logo-v4.jpg" alt="AgentForge" width="120" />
  </picture>
</p>

<h3 align="center">AgentForge</h3>

<p align="center">
  <strong>The batteries-included TypeScript Agent framework.</strong><br/>
  Pipeline-driven · Multi-agent orchestration · Any LLM provider
</p>

<p align="center">
  <a href="https://agentforge-docs.vercel.app/">Docs</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#why-agentforge">Comparison</a> ·
  <a href="docs/feature-tree.md">Feature Tree</a> ·
  <a href="#production">Production</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@primo-ai/core"><img src="https://img.shields.io/npm/v/@primo-ai/core?label=%40primo-ai%2Fcore&style=flat-square" alt="npm" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white&style=flat-square" alt="TypeScript" />
  <a href="https://github.com/Yamdy/agentforge/stargazers"><img src="https://img.shields.io/github/stars/Yamdy/agentforge?style=social" alt="stars" /></a>
</p>

<p align="center">
  English | <a href="./README.zh-CN.md">中文</a>
</p>

---

## 💡 Why AgentForge?

Every pipeline stage is simultaneously an **extension point**, an **observability span**, and a **hook interception point** — one mechanism, three capabilities.

- ⚙️ [**Pipeline Engine**](docs/feature-tree.md#sf-1-agent-pipeline-engine) — 10-stage processor pipeline with preLoop / loop / postLoop sections, 4 control flows (abort / retry / suspend / error)
- 🤖 [**Multi-Agent Orchestration**](docs/feature-tree.md#sf-4-multi-agent-orchestration) — Sequential, Parallel, and Router executors — declare complex workflows in a fluent pipeline
- 🧠 [**LLM Integration**](docs/feature-tree.md#sf-2-llm-integration) — Gateway chain with OpenAI, Anthropic, Google, DeepSeek, and any OpenAI-compatible endpoint. Built-in compat rules and model fallback
- 🛠️ [**16 Built-in Tools**](docs/feature-tree.md#sf-3-tool-system) — File, web, system, utility, memory — plus MCP protocol for external tools and sub-agent-as-tool
- 🔌 [**15+ Production Plugins**](docs/feature-tree.md#sf-7-plugin-system) — Memory, compression, permission, skill, MCP, eviction, validation, cost cap, token budget, rate limit, PII, moderation
- 📋 [**Task Queue**](docs/feature-tree.md#sf-10-task-management) — Priority-based concurrency control with auto-checkpoint recovery for long-running tasks
- 💾 [**Session Persistence**](docs/feature-tree.md#sf-6-session--persistence) — Suspend / resume with JSONL and SQLite backends. 11 event types for full replay. Built for HITL workflows
- 🌐 [**A2A Protocol**](docs/feature-tree.md#sf-9-server--deployment) — Native Agent-to-Agent JSON-RPC with streaming, agent cards, and artifact exchange

## 🚀 Quick Start

```bash
npm install @primo-ai/core
```

```typescript
import { Agent, registerProvider } from '@primo-ai/core';

registerProvider('deepseek', (modelId) =>
  createOpenAICompatible({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY!,
  }).languageModel(modelId)
);

const { response } = await new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
}).run('Hello!');
```

<details>
<summary>Using OpenAI / Anthropic / Google</summary>

```typescript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

registerProvider('openai',    (m) => createOpenAI({ apiKey: process.env.OPENAI_API_KEY! }).languageModel(m));
registerProvider('anthropic', (m) => createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }).languageModel(m));

const agent = new Agent({ model: 'anthropic/claude-sonnet-4-6-20250514', systemPrompt: 'You are a helpful assistant.' });
```

</details>

## 📦 Examples

### 🤝 Multi-agent orchestration

```typescript
import { createPipeline } from '@primo-ai/core';

const result = await createPipeline()
  .step({ name: 'research', agent: researcherAgent })
  .step({
    name: 'parallel-review',
    agents: [criticAgent, factCheckerAgent],
    options: { aggregator: (r) => r.map(x => x.response).join('\n---\n') },
  })
  .step({
    name: 'route',
    router: {
      classifier: (input) => input.includes('code') ? 'coder' : 'writer',
      routes: { coder: coderAgent, writer: writerAgent },
    },
  })
  .run('Explain quicksort');
```

### 🔌 Add production plugins

```typescript
import { memoryPlugin, compressionPlugin, permissionPlugin } from '@primo-ai/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
  plugins: [
    memoryPlugin({ backend: 'sqlite' }),
    compressionPlugin({ maxTokens: 8000 }),
    permissionPlugin({ mode: 'interactive' }),
  ],
});
```

### 📋 Task Queue

```typescript
import { TaskQueueImpl } from '@primo-ai/core';

const queue = new TaskQueueImpl({ maxConcurrency: 4, persistence: 'file' });
const handle = await queue.enqueue('analyst', { input: 'Analyze this dataset...' }, {
  priority: 5, timeout: 600_000, autoCheckpoint: true,
});

handle.on('complete', (data) => console.log('Done:', data));
```

### ⚙️ Custom processor

```typescript
import { createFactInjectionProcessor } from '@primo-ai/plugins';

const agent = new Agent({
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You are a helpful assistant.',
  plugins: [{
    name: 'inject-time',
    processors: [{
      stage: 'buildContext',
      processor: createFactInjectionProcessor({
        facts: { currentTime: () => new Date().toISOString() },
      }),
    }],
  }],
});
```

> [!TIP]
> Every stage emits events — subscribe with zero setup: `agent.eventSystem.subscribe('invokeLLM:after', handler)`

## ⚖️ Comparison

| | AgentForge | Mastra | AgentScope | CrewAI |
|---|---|---|---|---|
| Language | TypeScript | TypeScript | Python | Python |
| Pipeline model | Processor + Span + Hook | Middleware only | Pipeline only | Task-based |
| Multi-agent | Sequential / Parallel / Router | Manual | Basic | Crew + Flow |
| Production guardrails | costCap, tokenBudget, rateLimit, PII, moderation | Partial | Not built-in | Not built-in |
| A2A protocol | Native + streaming | Manual | Native | Not built-in |
| Task queue | Priority + concurrency + checkpoint | Basic | Not built-in | Not built-in |
| Session persistence | JSONL + SQLite + checkpoint | Basic | SQLite | Basic |
| Plugin system | 15+ built-in, 1-line register | Limited | Toolkit + MCP | Tools + MCP |

## 🏗️ Architecture

```
processInput → buildContext → [Agentic Loop:
  prepareStep → gateLLM → invokeLLM → processStepOutput → gateTool → executeTools → evaluateIteration
] → processOutput
```

Every stage receives a `PipelineContext` with three regions:

| Region | Purpose |
|--------|---------|
| `agent` | Config, system prompt, tool declarations, prompt fragments |
| `iteration` | Per-step state (response, tool calls, loop directive, span) |
| `session` | Cross-step state (input, sessionId, history, token usage, plugin data) |

```
packages/
  sdk/             -- Pure type definitions (zero dependencies)
  tools/           -- 16 built-in tools (file · web · system · utility · memory)
  observability/   -- Span · Tracer · Metrics + OpenTelemetry bridge
  core/            -- Agent · Pipeline · LLMInvoker · Orchestration · TaskQueue · Session
  plugins/         -- 15+ processor plugins
  server/          -- HTTP server · A2A protocol · CLI · Studio UI
```

## 🏭 Production

<details>
<summary>Configuration</summary>

Multi-level JSONC config (highest priority first):

1. **Session-level** — runtime params passed to `agent.run()`
2. **Project-level** — `.agentforge/config.jsonc`
3. **Global-level** — `~/.agentforge/config.jsonc`

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

</details>

<details>
<summary>CLI</summary>

```bash
npx agentforge serve --port 3000 --api-key secret   # Start server
npx agentforge serve --studio                        # With observability UI at /studio
npx agentforge run --agent assistant --input "Hello" # Single invocation
npx agentforge dev --config .agentforge/config.jsonc # Dev mode with watch
```

</details>

<details>
<summary>API Endpoints</summary>

```
GET  /health/live                    GET  /sessions
POST /agents/:id/run                 GET  /sessions/:id
GET  /agents/:id/stream (SSE)        GET  /sessions/:id/messages
POST /sessions/:id/prompt            POST /sessions/:id/abort
GET  /permissions/pending            POST /permissions/pending/:id/respond
GET  /providers                      GET  /mcp / POST /mcp
GET  /api/studio/traces              GET  /api/studio/metrics
GET  /api/studio/sessions            GET  /studio/* (SPA)
```

</details>

<details>
<summary>Docker</summary>

```bash
docker compose up
```

Container exposes port 3000 with health checks. Mount your config at `/app/.agentforge/`.

</details>

---

## 🤝 Contributing

See [CLAUDE.md](./CLAUDE.md) for development commands and architecture details.

## License

MIT
