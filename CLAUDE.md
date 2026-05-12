# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build all packages (respects dependency order via turbo)
pnpm build

# Run all tests
pnpm test

# Run tests for a single package
pnpm --filter @agentforge/core test

# Run a single test file
pnpm --filter @agentforge/core vitest run __tests__/pipeline.test.ts

# Type-check all packages
pnpm check-types

# Run a single example (requires .env in examples/)
cd examples && npx tsx unified-demo.ts
```

## Architecture

**AgentForge** is a TypeScript agent framework built around a Processor Pipeline model. The agent lifecycle is a linear pipeline of stages, each simultaneously an extension point (Processor), an observability span, and a hook interception point.

### Monorepo Structure (pnpm + Turborepo)

```
packages/
  sdk/         — Pure type definitions (PipelineContext, Processor, Tool, Span, etc.)
  tools/       — Tool implementations (echo tool, etc.)
  observability/ — Span/Tracer/Metrics abstractions + OTel bridge
  core/        — PipelineRunner, Agent (orchestration), LLMInvoker, ToolRegistry, SessionManager, etc.
    core/processors/ — 8 built-in pipeline stage processors (extracted from Agent)
    process-input, build-context, prepare-step, invoke-llm, evaluate-iteration (substantive)
    process-step-output, execute-tools, process-output (no-op extension points)
    provider-history-compat (compat rules engine)
    core/gateways/ — GatewayChain, BuiltInGateway, OpenAICompatibleGateway
    provider-capabilities.ts — Provider capability detection
  plugins/     — Processor plugins: memory, compression, permission, skill, MCP, eviction
```

Dependency direction: `sdk` (zero deps) ← `tools` / `observability` ← `core` ← `plugins`.

### Pipeline Context — Four Regions

Every stage receives a `PipelineContext` with four regions:
- `request` — immutable input (user message, sessionId)
- `agent` — config + prompt + tool declarations + promptFragments
- `iteration` — per-step state (step number, response, loopDirective, span)
- `session` — cross-iteration state (messageHistory, tokenUsage, plugin custom data)

### Agent Lifecycle Pipeline

```
processInput → buildContext → [Agentic Loop:
  prepareStep → invokeLLM → processStepOutput → executeTools → evaluateIteration
] → processOutput
```

The agentic loop repeats until `iteration.loopDirective` is `stop`. Processors can return an `AbortSignal` to abort with optional `retryFrom` a specific stage.

### Key Patterns

- **Processor**: `(context) => Promise<ProcessorResult>` — registered per stage, executes business logic. Substantive processors (`invokeLLM`, `buildContext`, etc.) live in `core/processors/` as factory functions; no-op extension points are const exports.
- **Plugin**: factory function `(harness: HarnessAPI) => PluginRegistration` — registers processors, tools, hooks, resources
- **Dynamic\<T\>**: `T | ((ctx) => T)` — AgentConfig fields resolved per-request at `processInput` stage
- **ToolRegistry**: adapts Tool definitions to AI SDK format via `toAiSdkToolSchemas()` (schemas only, no execute). AgentForge pipeline controls tool execution via `executeTool()` with before/after hooks.
- **LLMInvoker**: wraps `ai.streamText()` for single-step LLM calls (no `maxSteps`), returns `fullStream` + `usage` + `reasoning` promises. Retry at invoke level only.
- **Model resolution**: `resolveModel()` maps model strings (e.g. `"deepseek/deepseek-v4-flash"`) to AI SDK `LanguageModel` instances via pluggable `GatewayChain` (custom gateways → `BuiltInGateway`). Custom OpenAI-compatible endpoints via `GatewayConfig`.
- **Provider compatibility**: `ProviderCapabilities` detection + `CompatRule` engine. Preemptive rules rewrite messages before LLM call; reactive rules fix history on API error. `providerOptions` passthrough from `AgentConfig` to `streamText()`.

### Configuration Merging

Multi-level JSONC config (highest priority first):
1. Session-level — runtime params passed to `agent.run()`
2. Project-level — `.agentforge/config.jsonc`
3. Global-level — `~/.agentforge/config.jsonc`
4. Environment — `AGENTFORGE_CONFIG` env var

### Session Persistence

JSONL file storage with tree branching via `parentSessionId`. Supports suspend/resume for HITL workflows.

## Agent skills

### Issue tracker

Issues tracked as local markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
