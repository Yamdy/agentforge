<!-- Generated: 2026-05-24 | Files scanned: 145 | Token estimate: ~900 -->

# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     @primo-ai/server                        │
│  Hono HTTP + WS ── AgentRegistry ── AgentForgeServer        │
│  Routes: /agents /sessions /permissions /mcp /a2a /studio   │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────┐          ┌───────────────────────────┐
│   @primo-ai/core     │          │  @primo-ai/plugins        │
│  Agent (facade)      │◄─────────│  memory/compression/      │
│  PipelineRunner      │          │  permission/skill/mcp/    │
│  LoopOrchestrator    │          │  eviction/validation/     │
│  LLMInvoker          │          │  harness processors       │
│  ToolRegistry        │          └───────────────────────────┘
│  ContextBuilder      │
│  EventSystem         │          ┌───────────────────────────┐
│  HookManager         │◄─────────│  @primo-ai/observability  │
│  StateMachine        │          │  Tracer/Span/Metrics      │
│  CheckpointStore     │          │  OTel bridge + exporter   │
│  SessionManager      │          │  TraceCollector           │
│  ModelFactory        │          └───────────────────────────┘
│  Runner (concurrency)│
│  MemorySystem        │          ┌───────────────────────────┐
│  TaskQueue           │◄─────────│  @primo-ai/tools          │
└──────────┬───────────┘          │  echo/file/shell/http/    │
           │                       │  calculator/json/memory/  │
           ▼                       │  grep/glob/datetime/      │
┌──────────────────────┐          │  web-fetch/web-search     │
│   @primo-ai/sdk      │          └───────────────────────────┘
│  PipelineContext      │
│  Processor/Tool/Span  │          ┌───────────────────────────┐
│  Hook/StreamEvent     │          │  @primo-ai/studio-ui      │
│  AgentConfig/Dynamic  │          │  Vue 3 + TailwindCSS      │
│  CompatRule/Profile   │          │  Dashboard/Traces/         │
│  HarnessAPI           │          │  Sessions/Permissions      │
└──────────────────────┘          └───────────────────────────┘
```

## Dependency Graph

```
sdk (zero deps) ← tools / observability ← core ← plugins
                                            core ← server
                                            server ← studio-ui (API only)
```

## Agent Pipeline

```
processInput → buildContext → [Loop:
  prepareStep → gateLLM → invokeLLM → processStepOutput → gateTool → executeTools → evaluateIteration
] → processOutput
```

Loop repeats until `iteration.loopDirective = 'stop'`.

## PipelineContext — Three Regions (ADR-0007)

| Region | Scope | Key Fields |
|--------|-------|------------|
| `agent` | Config | config, systemPrompt, toolDeclarations, promptFragments, providerOptions |
| `iteration` | Per-step | step, loopDirective, content, response, pendingToolCalls, toolResults |
| `session` | Cross-step | input, sessionId, messageHistory, totalTokenUsage, custom |

## 7-Module Coverage

| Module | Status | Source |
|--------|--------|--------|
| PipelineRunner | Complete | `core/pipeline.ts` |
| ContextBuilder | Complete | `core/context-builder.ts` |
| LLMInvoker | Complete | `core/llm-invoker.ts` |
| ToolRegistry | Complete | `core/tool-registry.ts` |
| EventSystem | Complete | `core/event-system.ts` + `core/event-bus.ts` |
| HookManager | Complete | `core/hook-manager.ts` |
| CheckpointStore | Complete | `core/checkpoint-store.ts` |

## Key Packages

| Package | Role | Entry |
|---------|------|-------|
| sdk | Pure types, zero deps | `packages/sdk/src/index.ts` |
| core | Agent loop, pipeline, 7 modules | `packages/core/src/index.ts` |
| plugins | Processor plugins | `packages/plugins/src/index.ts` |
| observability | Span/Tracer/Metrics + OTel | `packages/observability/src/index.ts` |
| tools | 14 built-in tools | `packages/tools/src/index.ts` |
| server | HTTP server (Hono) + A2A | `packages/server/src/index.ts` |
| studio-ui | Vue 3 dashboard | `packages/studio-ui/src/main.ts` |
| create-agentforge | CLI scaffolding | `packages/create-agentforge/src/index.ts` |
