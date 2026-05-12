# AgentForge Architecture Audit Report

**Date**: 2026-05-12
**Mode**: First-principles analysis + industry benchmarking
**References**: OpenHarness, Mastra, pi-mono, DeepAgents, crewAI, AgentScope
**Goal**: Full-chain transparent observability, full-chain pluggable aspects, harness-engineering-grade agent framework

---

## Executive Verdict

```json
{
  "overall_health": "medium_risk",
  "primary_failure_mode": "LLM invoke and Tool execute dual-loop nesting breaks full-chain visibility",
  "most_urgent_fix": "Bring AI SDK internal tool-call loop back under AgentForge pipeline control"
}
```

The Processor Pipeline architecture is directionally correct — each stage is simultaneously an extension point, an observability span, and a hook interception point. However, there is a fundamental architectural gap: LLM calls and Tool execution are swallowed by the AI SDK's internal loop, creating a black box at the `invokeLLM` stage.

---

## 12-Layer Audit Mapping

| # | Layer | Status | Risk |
|---|-------|--------|------|
| 1 | System Prompt | processInput resolves Dynamic<T>, buildContext injects | Healthy |
| 2 | Session History | messageHistory is untyped (unknown[]) | Medium |
| 3 | Memory | Plugin with automatic/agent-controlled/both modes | Healthy |
| 4 | Compression | Plugin with truncate/summarize/prune phases | Healthy |
| 5 | Active Recall | Memory processor injects at buildContext | Healthy |
| 6 | Tool Selection | AI SDK streamText() routes internally, no visibility | **Critical** |
| 7 | Tool Execution | executeTools processor is no-op, actual execution inside AI SDK | **Critical** |
| 8 | Tool Interpretation | AI SDK processes internally, results via textStream | **Medium** |
| 9 | Answer Shaping | processOutput is no-op extension point | Medium |
| 10 | Platform Rendering | stream() returns AsyncGenerator<string>, no structured protocol | Medium |
| 11 | Hidden Repair Loops | FallbackRunner and retryWithBackoff are explicit | Healthy |
| 12 | Persistence | JSONL + tree branching, restore reconstruction incomplete | Medium |

---

## Findings (by severity)

### F-1 [CRITICAL] Dual-loop architecture: LLM loop swallows Tool execution pipeline

**Mechanism**: `invokeLLM` calls `LLMInvoker.stream()` -> AI SDK `streamText({tools, maxSteps})`. The AI SDK internally executes the full tool-call loop (detect tool_use -> execute -> feed result back -> loop).

Consequences:
- `executeTools` processor is no-op (`agent.ts:195`)
- Tool execution bypasses AgentForge pipeline
- `beforeTool`/`afterTool` hooks only fire inside `ToolRegistry.toAiSdkTools()` execute callback, not through PipelineRunner span/tracing
- Intermediate tool-call token usage is lost (`llm-invoker.ts:81-84` captures only final usage)

**Root cause**: AI SDK's `streamText()` is a self-contained agent loop, nesting inside AgentForge's agentic loop.

**Evidence**: `agent.ts:80-97` (outer loop) vs `llm-invoker.ts:58-59` (`stepCountIs(maxSteps)` triggers inner loop)

**Fix**: Adopt "single-step" mode — `LLMInvoker` does single LLM call (no `maxSteps`), tool detection in `processStepOutput`, tool execution in `executeTools`.

**References**: Mastra `loop.ts` and pi-mono `agent-loop.ts` both use self-controlled loops with AI SDK doing only single-step generation.

---

### F-2 [CRITICAL] evaluateIteration always stops, agentic loop is effectively dead

**Mechanism**: Default `evaluateIterationProcessor` always returns `{ action: 'stop' }`. Only exception is token overflow (>100k) which also stops.

Consequences:
- AgentForge's agentic loop (`agent.ts:80-97`) almost always executes exactly once
- AI SDK's `maxSteps` may execute N tool-call steps, but AgentForge sees this as one "iteration"
- `maxIterations` controls a coarser loop with unclear semantics

**Root cause**: No signal extraction from LLM response about whether to continue.

**Evidence**: `processors/evaluate-iteration.ts` — entire file

**Fix**: `evaluateIteration` should check whether LLM response contains pending tool calls, mapping "more steps needed" to `{ action: 'continue' }`.

---

### F-3 [HIGH] Observability incomplete: Tracer doesn't propagate, Spans don't export

**TracerImpl doesn't propagate**: `tracer.ts:73-79` generates new `traceId` per `startSpan()`. `PipelineRunner` uses `rootSpan.startChild()` correctly, but `TracerImpl.startSpan()` doesn't maintain currentSpan context.

**Spans don't export**: `SpanImpl.end()` only sets `_ended = true`, no exporter/metrics/OTLP output.

**No Metrics implementation**: SDK defines `Metrics` interface but no implementation exists.

**Evidence**: `tracer.ts:34`, `otel-bridge.ts:82-83`

---

### F-4 [HIGH] buildContext and prepareStep have overlapping responsibilities

Both processors attach tool declarations to `ctx.agent`. `buildContext` does it in pre-loop, `prepareStep` re-does it per iteration.

**Evidence**: `build-context.ts` vs `prepare-step.ts` (both call `registry.getDeclarations()`)

---

### F-5 [HIGH] Tool hook chain not in PipelineRunner span context

`ToolRegistry.toAiSdkTools()` execute callback invokes hooks outside PipelineRunner's span context. Tool hooks are not traced, durations not recorded.

**Evidence**: `tool-registry.ts:90-130` vs `pipeline.ts:106-125`

---

### F-6 [MEDIUM] Session messageHistory untyped

SDK types `messageHistory` as `unknown[]`. No `{ role, content }` structure.

---

### F-7 [MEDIUM] No pipeline-level interceptor/middleware pattern

Hooks are event-based (fire-and-forget) or wrap-based (transform), but not at pipeline level. No global before/after stage interception.

---

### F-8 [MEDIUM] FallbackRunner doesn't share LLMInvoker span/tracer

Fallback events go through EventBus but not in OTel span context.

---

### F-9 [LOW] Object.freeze is shallow

Nested objects in PipelineContext can still be mutated despite freeze.

---

## Industry Benchmarking

| Capability | AgentForge | Mastra | pi-mono | OpenHarness | DeepAgents |
|-----------|-----------|--------|---------|-------------|------------|
| Agent Loop Control | Dual (outer + inner AI SDK) | Single self-controlled | Single self-controlled | Single self-controlled | LangGraph StateGraph |
| Tool Exec Visibility | Black box (inside AI SDK) | Full visibility | Full visibility | Full visibility | Full visibility |
| Processor Pipeline | 8 stages | Yes | Event-driven | while-true loop | Middleware stack |
| Hook/Interceptor | 11 hook points | Yes | Yes | PreToolUse/PostToolUse | Middleware |
| Plugin System | HarnessAPI | Yes | Extensions | plugin.json | Middleware |
| Observability | Span + OTel Bridge | OTel + TelemetryService | Usage tracking | Token + cost | LangSmith |
| Memory | Plugin (InMemory/SQLite) | Semantic+Working+Obs | Transform context | MEMORY.md + compress | MemoryMiddleware |
| Permission | Plugin (allow/deny/ask) | PermissionPolicy | beforeToolCall gate | Multi-level + path rules | Permission middleware |
| Multi-Agent | SubAgentTool (3 policies) | SubAgentTool+Network+A2A | Subagent spawning | Coordinator+Swarm | SubAgentMiddleware |
| MCP | Plugin (stdio) | Server/Client | via extensions | HTTP transport | MCP providers |

**Key gap**: AgentForge's Processor Pipeline design is architecturally leading, but LLM-Tool interaction implementation lags all reference frameworks.

---

## Fix Plan (priority order)

### P1: Reclaim Tool Execution Control [CRITICAL]
- `LLMInvoker` does single-step calls (no `maxSteps`)
- `processStepOutput` extracts tool_calls from LLM response
- `executeTools` becomes real executor with span + hook chain
- `evaluateIteration` decides continue/stop based on pending tool calls

### P2: Fix Agentic Loop Semantics [CRITICAL]
- Depends on P1
- `evaluateIteration` checks for pending tool_calls -> continue; none -> stop

### P3: Complete Observability [HIGH]
- Add span exporter callback to TracerImpl
- Implement Metrics interface
- Fix TracerImpl currentSpan propagation

### P4: Merge buildContext and prepareStep [HIGH]
- Eliminate responsibility overlap
- buildContext: one-time setup
- prepareStep: per-iteration context prep only

### P5: Add Pipeline-level Interceptor [MEDIUM]
- Global beforeStage/afterStage/onError hooks

### P6: Type Message History [MEDIUM]
- Replace unknown[] with typed Message[] union

### P7: Production Infrastructure [LOW]
- Structured error types
- Token/cost tracking
- Streaming transport protocol
- HITL approval gate

---

## Architectural Strengths (preserve)

1. **Processor = Extension point + Span + Hook interception** trinity is industry-leading
2. **Four-Region Context** (request/agent/iteration/session) is more structured than Mastra's single state
3. **Plugin HarnessAPI** surface is complete
4. **Dynamic<T>** pattern solves per-request config resolution
5. **Permission plugin** (allow/deny/ask + glob) is among the most complete implementations
