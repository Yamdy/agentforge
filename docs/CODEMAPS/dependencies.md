<!-- Generated: 2026-05-24 | Files scanned: 8 | Token estimate: ~600 -->

# Dependencies

## Internal Package Dependencies

```
sdk ← tools, observability
sdk ← core
core ← plugins
core ← server
observability ← core (OTelBridge)
tools ← core (echoTool default)
server ← studio-ui (serves built assets)
```

## Core — External Dependencies

| Package | Purpose |
|---------|---------|
| `ai` (Vercel AI SDK) | `streamText()` for LLM calls |
| `@ai-sdk/openai` | OpenAI provider (default gateway) |
| `@ai-sdk/anthropic` | Anthropic provider |
| `tiktoken` | Token counting (TiktokenCounter) |
| `better-sqlite3` | SQLite session storage + memory backend |
| `zod` | Schema validation |

## Observability — External Dependencies

| Package | Purpose |
|---------|---------|
| `@opentelemetry/api` | OTel trace context |
| `@opentelemetry/sdk-trace-node` | OTel tracer provider |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP HTTP exporter |
| `@opentelemetry/sdk-metrics` | OTel metrics |

## Server — External Dependencies

| Package | Purpose |
|---------|---------|
| `hono` | HTTP framework |
| `@hono/node-server` | Node.js adapter for Hono |
| `ws` | WebSocket support (optional, lazy-loaded) |
| `commander` | CLI (`agentforge serve`) |

## Studio UI — External Dependencies

| Package | Purpose |
|---------|---------|
| `vue` | UI framework (Vue 3) |
| `vue-router` | Client-side routing |
| `tailwindcss` | Utility CSS |

## Plugins — External Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP client implementation |

## Tools — External Dependencies

| Package | Purpose |
|---------|---------|
| `globby` | File glob tool |
| `ripgrep` (via exec) | Grep tool (shell execution) |
| `node-fetch` / native | HTTP tool, web-fetch/web-search |

## Build & Dev

| Tool | Purpose |
|------|---------|
| `pnpm` | Package manager (monorepo) |
| `turborepo` | Build orchestration |
| `typescript` | Type checking |
| `vitest` | Test runner |
| `vite` | Studio UI bundler |
