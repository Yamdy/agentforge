Status: done

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Set up the 5-package TypeScript monorepo and define all core type interfaces that the rest of the framework depends on.

**Packages to create:**
- `packages/core/` — Agent Loop, Processor Pipeline, Context, Tool Registry (empty scaffolding)
- `packages/observability/` — Span, Tracer, Metrics abstractions (empty scaffolding)
- `packages/plugins/` — Built-in Processors (empty scaffolding)
- `packages/tools/` — Built-in tools (empty scaffolding)
- `packages/sdk/` — Public type definitions and interfaces

**Core types to define in `@harness/sdk`:**
- `Processor` interface — stage identifier + execute method signature
- `PipelineStage` union type — the 8 stage names + tool sub-pipeline stages
- `PipelineContext` type — request, iteration, pipeline, session, config, span, tools
- `Tool` interface — name, description, inputSchema, outputSchema, execute, requireApproval, renderCall, renderResult
- `ToolDefinition` — the shape a plugin uses to register a tool
- `Span` interface — startSpan, endSpan, addEvent, setAttribute, spanContext
- `Tracer` interface — startSpan, getCurrentSpan
- `Metrics` interface — increment, gauge, histogram
- `HarnessAPI` interface — registerProcessor, registerTool, registerCommand, registerProvider, onEvent
- `PluginRegistration` type — what a plugin factory function returns
- `AbortSignal` / `TripWire` — how a Processor stops the pipeline
- `SuspendResult` — how a Processor pauses execution
- `AgentConfig` — model, tools, processors, system prompt, max iterations
- `SpanType` enum — AGENT_RUN, MODEL_STEP, TOOL_CALL, PROCESSOR_RUN, etc.

**Tooling setup:**
- pnpm workspace + Turborepo
- TypeScript strict mode across all packages
- Vitest for testing
- ESLint + Prettier

## Acceptance criteria

- [x] All 5 packages exist with valid package.json and tsconfig.json
- [x] `pnpm install` and `pnpm build` succeed across the monorepo
- [x] All core types are exported from `@harness/sdk`
- [x] Types compile with strict TypeScript (no `any`)
- [x] Empty test suite runs successfully (`pnpm test`)

## Blocked by

None — can start immediately
