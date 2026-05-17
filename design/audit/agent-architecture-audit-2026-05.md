# Agent Architecture Audit Report

**Date**: 2026-05-14
**Auditor**: Claude (ecc:agent-architecture-audit)
**Schema**: ecc.agent-architecture-audit.report.v1

---

## Executive Verdict

| Field | Value |
|-------|-------|
| Overall Health | **Healthy** |
| Primary Failure Mode | All findings resolved |
| Most Urgent Fix | None — all F-1 through F-8 resolved |

---

## Scope

| Field | Value |
|-------|-------|
| Target | AgentForge — TypeScript Agent Framework |
| Entrypoints | `Agent.run()` / `Agent.stream()` / `Agent.resume()` |
| Model Stack | AI SDK (`ai.streamText`), multi-provider via GatewayChain |
| Layers Audited | All 12 layers |
| Additional Dimension | 7-module ideal structure comparison |

---

## 7-Module Mapping

| # | Ideal Module | Actual Implementation | Status | Gap |
|---|-------------|----------------------|--------|-----|
| 1 | PipelineRunner | `pipeline.ts` + `loop-orchestrator.ts` + `state-machine.ts` | ✅ | StateMachine correctly embedded in LoopOrchestrator |
| 2 | ContextBuilder | `build-context.ts` + `prepare-step.ts` + `CompressionStrategy` | ✅ | SlidingWindowStrategy built-in, plugin extensibility |
| 3 | LLMInvoker | `llm-invoker.ts` | ✅ | invoke/stream dual mode, clean retry |
| 4 | ToolRegistry | `tool-registry.ts` | ✅ | Register/validate(Zod)/execute/hooks/truncate |
| 5 | EventSystem | `event-system.ts` + `session-persistence.ts` + `storage-replay-backend.ts` | ✅ | Unified EventSystem with query/replay, sentinel dedup |
| 6 | HookManager | `hook-manager.ts` | ✅ | Priority/profile/disable |
| 7 | CheckpointStore | `serialize.ts` + `checkpoint-store.ts` (InMemory + Jsonl) | ✅ | Persistent via JsonlCheckpointStore, injected into LoopOrchestrator |

**Score: 7/7 complete.**

---

## Findings

### F-1 [HIGH] ContextBuilder Severely Underdeveloped

- **Layer**: Layer 2 (Session History) + Layer 4 (Distillation)
- **Mechanism**: `prepare-step.ts` only does `history.slice(-maxHistory)` hard truncation. No semantic compression, no summarization, no deduplication.
- **Root Cause**: Compression capability lives in `plugins/compression/` as optional plugin, not as core ContextBuilder capability.
- **Evidence**: `packages/core/src/processors/prepare-step.ts:8-11`, `packages/core/src/processors/build-context.ts:4-20`
- **Confidence**: 0.92
- **Fix**: Make compression a core ContextBuilder capability, not an optional plugin.

### F-2 [HIGH] CheckpointStore Memory-Only

- **Layer**: Layer 12 (Persistence)
- **Mechanism**: `LoopOrchestrator.checkpoints = new Map()` — all pending state lost on process crash.
- **Root Cause**: SessionPersistence writes event logs but not checkpoints. `serialize()` exists but has no persistent backend.
- **Evidence**: `packages/core/src/loop-orchestrator.ts:28`, `packages/core/src/serialize.ts:12-19`
- **Confidence**: 0.95
- **Fix**: CheckpointStore should delegate to SessionStorage or a dedicated persistent backend.

### F-3 [HIGH] Hidden Reactive Compat Retry Loop

- **Layer**: Layer 11 (Hidden Repair Loops)
- **Mechanism**: LoopOrchestrator silently calls `applyReactiveRules()` on API error, modifies history, then `continue`s the loop. User has no visibility.
- **Root Cause**: Reactive compat rules execute at loop level without logging or events.
- **Evidence**: `packages/core/src/loop-orchestrator.ts:62-69`, `packages/core/src/loop-orchestrator.ts:163-176`
- **Confidence**: 0.88
- **Fix**: Emit events + record span on compat retry, or make it an explicit retry stage.

### F-4 [MEDIUM] PipelineRunner Stream Consumption Duplication

- **Layer**: Layer 9 (Answer Shaping) — maintainability risk
- **Mechanism**: `consumeStream()` (run path) and inline logic in `stream()` are nearly identical but maintained separately.
- **Evidence**: `packages/core/src/pipeline.ts:59-90` vs `packages/core/src/pipeline.ts:191-238`
- **Confidence**: 0.85
- **Fix**: Extract shared stream parsing helper.

### F-5 [MEDIUM] Hook Silently Mutates Tool Output

- **Layer**: Layer 7 (Tool Execution) + Layer 11 (Hidden Agent Layers)
- **Mechanism**: `tool-registry.ts:117` — `tool.after` hook can replace `hookOutput.result`, caller unaware.
- **Evidence**: `packages/core/src/tool-registry.ts:114-119`
- **Confidence**: 0.82
- **Fix**: Record output mutations to span or emit event.

### F-6 [MEDIUM] Tool Requirements Only in Prompt Text

- **Layer**: Layer 6 (Tool Selection)
- **Mechanism**: No code-level enforcement of "must use tool X". If prompt says "must use search_tool", model can skip it with no code-level consequence.
- **Evidence**: No tool requirement gate in entire codebase.
- **Confidence**: 0.78
- **Fix**: Add tool requirement validation in evaluateIteration or a dedicated gate stage.

### F-7 [LOW] EventBus Has No Replay Capability

- **Layer**: Layer 12 (Persistence) + 7-module EventSystem
- **Mechanism**: EventBus only has emit/subscribe. SessionManager.restore() rebuilds context by re-reading event log, but this isn't an EventSystem capability.
- **Evidence**: `packages/core/src/event-bus.ts:1-21`
- **Confidence**: 0.70
- **Fix**: Per 7-module conclusion, merge EventBus + EventStore, support emit() + replay().

### F-8 [LOW] EventBus Swallows Handler Errors

- **Layer**: Layer 11 (Hidden Repair Loops)
- **Mechanism**: `event-bus.ts:7` — no try/catch around handler calls. HookManager.bridge() at line 101 does catch and swallow.
- **Evidence**: `packages/core/src/event-bus.ts:7`, `packages/core/src/hook-manager.ts:100-106`
- **Confidence**: 0.65
- **Fix**: EventBus.emit() should isolate each handler's errors.

---

## Ordered Fix Plan

| # | Goal | Why Now | Expected Effect |
|---|------|---------|-----------------|
| 1 | CheckpointStore persistence | Crash = total state loss, unacceptable for production | Suspend/resume truly reliable |
| 2 | Reactive Compat observability | Hidden retry = silent correctness risk | Compat fixes visible to users/devs |
| 3 | ContextBuilder compression injection | Long conversations cause token overflow | Context management beyond hard truncation |
| 4 | Stream consumption deduplication | Same logic maintained twice = divergent bugs | One change, two paths |
| 5 | Tool after hook change recording | Silent output mutation = hard to debug | Output changes have audit trail |
| 6 | Tool Requirement Gate | Prompt-only constraint = model can bypass | Critical tool usage enforceable |
| 7 | EventBus replay capability | 7-module conclusion requires unified EventSystem | Full event sourcing |
| 8 | EventBus handler error isolation | Current propagation is fragile | Single handler failure contained |

---

## Quick Diagnostic Answers

| # | Question | Answer | Implication |
|---|----------|--------|-------------|
| 1 | Can model skip a required tool? | Yes | Tool not code-gated (F-6) |
| 2 | Does old content appear in new turns? | Only via truncation | Hard truncation, no semantic filtering (F-1) |
| 3 | Same info in prompt AND memory AND history? | Possible via plugins | Context duplication risk (F-1) |
| 4 | Does platform run second LLM pass? | Yes (compat) | Hidden repair loop (F-3) |
| 5 | Does output differ internal vs delivery? | Possible via hooks | Hook mutation (F-5) |
| 6 | Are "must use tool" rules only in prompt? | Yes | Tool discipline failure (F-6) |
| 7 | Can agent monologue become memory? | Via memory plugin | Depends on plugin quality |

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │           Agent (Facade)                │
                    │  run() / stream() / resume()            │
                    └──────────┬──────────────────────────────┘
                               │
                    ┌──────────▼──────────────────────────────┐
                    │       LoopOrchestrator                   │
                    │  runLoop / streamLoop / resumeLoop       │
                    │  ┌─ StateMachine (internal)              │
                    │  └─ checkpoints (Map — ⚠️ memory-only)   │
                    └──────────┬──────────────────────────────┘
                               │
          ┌────────────────────┼─────────────────────────┐
          │                    │                          │
    ┌─────▼──────┐   ┌────────▼─────────┐   ┌───────────▼──────────┐
    │PipelineRunner│  │  HookManager     │   │  CompatRules          │
    │ (stage exec) │  │  (cross-cutting) │   │  (⚠️ hidden retry)    │
    └──────┬──────┘  └────────┬──────────┘   └──────────────────────┘
           │                  │
    ┌──────▼──────────────────▼───────────────────────────────┐
    │              8 Processors (Pipeline Stages)              │
    │                                                          │
    │  buildContext ─── ⚠️ field mapping only                  │
    │  prepareStep ──── ⚠️ hard truncation last 50             │
    │  invokeLLM ────── ✅ delegates to LLMInvoker             │
    │  processStepOutput ── ✅ message construction             │
    │  executeTools ───── ✅ delegates to ToolRegistry          │
    │  evaluateIteration ── ✅ token cap + loop directive       │
    │  processInput ───── ✅ Dynamic<T> resolution             │
    │  processOutput ──── ✅ no-op extension point              │
    └──────────────────────────────────────────────────────────┘
           │              │               │
    ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
    │ LLMInvoker  │ │ToolRegistry│ │  EventBus    │
    │   ✅        │ │   ✅       │ │  ⚠️ no replay │
    └─────────────┘ └────────────┘ └──────┬───────┘
                                          │
                                   ┌──────▼────────┐
                                   │SessionPersist  │
                                   │  (event log)   │
                                   └───────────────┘
```

---

## Related

- 7-Module Conclusion: see project memory `project-production-agent-7-modules`
- Agent Design First Principles: see project memory `project-agent-design-from-first-principles`
- AOP First Principles: see project memory `project-aop-first-principles`
