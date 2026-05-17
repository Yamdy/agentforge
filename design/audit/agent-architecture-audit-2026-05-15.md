# Agent Architecture Audit Report (三形态/7模块交叉审计)

**Date**: 2026-05-15
**Auditor**: Claude (ecc:agent-architecture-audit)
**Baseline**: 2026-05-14 audit — all 8 findings (F-1~F-8) resolved, 7/7 modules nominally complete

---

## Executive Verdict

| Field | Value |
|-------|-------|
| Overall Health | **Medium Risk** |
| Primary Failure Mode | Capabilities exist but defaults are unsafe; Pipeline not truly "flow-as-data" |
| Most Urgent Fix | Default CheckpointStore → persistent + built-in semantic compression strategy |

The previous audit's 8 "point defects" are all fixed. This audit uses the three-form/7-module/AOP-three-methods framework to find **structural gaps** — not "missing features" but "architectural decisions making the default path unsafe" and "flow-as-data principle not honored."

---

## Three-Form → Code Mapping

```
Form 1 (Agent Loop = while+LLM+tools)
  while loop     → LoopOrchestrator.runLoop/streamLoop    ✅
  LLM call       → LLMInvoker.invoke/stream               ✅
  Tools          → ToolRegistry + executeTools processor   ✅
  Context assembly → ContextBuilder.assemble              ⚠️ Default strategy too weak

Form 2 (Harness = observe+control+intervene)
  observe        → EventSystem + span attributes + events  ⚠️ Scattered, no unified API
  control        → StateMachine + token cap + step limit   ⚠️ Scattered across 4+ places
  intervene      → HookManager + compat rules + abort      ⚠️ Three intervention paths not unified

Form 3 (Runtime = EventBus+LifecycleState+Hooks)
  EventBus       → EventSystem (EventBus + replay)        ✅ Unified
  LifecycleState → StateMachine (inside LoopOrchestrator)  ✅ Merged
  Hooks          → HookManager                            ✅
```

All three-form capabilities **exist**, but not exposed as a coherent API.

---

## AOP Three Methods → Code Mapping

```
Method 1 (callback/hook)    → HookManager, tool before/after hooks   ✅ Complete
Method 2 (flow as data)     → Pipeline Stages arrays                 ❌ In name only
Method 3 (side observing)   → EventSystem (emit + replay)            ✅ Complete
```

**Method 2 critical issue**: Pipeline stages are `const` arrays in `loop-orchestrator.ts:17-21`. Plugins can only register Processors for existing stage names — they cannot insert, reorder, or delete stages. This is effectively Method 1 (fixed-position callbacks) wearing Method 2's clothing.

---

## 7-Module Current Status

| # | Module | Status | Previous | Current Reality |
|---|--------|--------|----------|-----------------|
| 1 | PipelineRunner | ✅ | ✅ | ✅ Complete |
| 2 | ContextBuilder | ⚠️ | ❌ | ⚠️ Architecture right, default weak |
| 3 | LLMInvoker | ✅ | ✅ | ✅ Complete |
| 4 | ToolRegistry | ✅ | ✅ | ✅ Complete |
| 5 | EventSystem | ✅ | ❌ | ✅ Unified + replay |
| 6 | HookManager | ✅ | ✅ | ✅ Complete |
| 7 | CheckpointStore | ⚠️ | ❌ | ⚠️ Implementation exists, default volatile |

Previously 4/7, now nominally 7/7, but 2 modules are "above passing, below excellent."

---

## Findings

### N-1 [HIGH] Default CheckpointStore is InMemory

- **12-layer map**: Layer 12 (Persistence)
- **Mechanism**: `LoopOrchestrator` defaults to `new InMemoryCheckpointStore()`. `JsonlCheckpointStore` exists but requires explicit injection.
- **Root cause**: Crash = state loss by default.
- **Evidence**: `loop-orchestrator.ts:44`
- **Confidence**: 0.92
- **Fix**: Default to `JsonlCheckpointStore` with temp directory when none provided.

### N-2 [HIGH] Default Compression Strategy is Trivial Truncation

- **12-layer map**: Layer 2 (Session History) + Layer 4 (Distillation)
- **Mechanism**: `ContextBuilder` defaults to `slidingWindow` = `messages.slice(-50)`. No semantic dedup, summarization, or priority eviction.
- **Root cause**: Architecture supports injection but provides no production-usable built-in strategy.
- **Evidence**: `context-builder.ts:23-25`
- **Confidence**: 0.88
- **Fix**: Provide `semanticTruncation` as default (retain system + recent user + summarized old tool results).

### N-3 [MEDIUM] Pipeline Does Not Implement "Flow as Data"

- **AOP map**: Method 2 exists in name only
- **Mechanism**: `PRE_LOOP_STAGES` / `LOOP_STAGES` / `POST_LOOP_STAGES` are hardcoded constants. Plugins cannot insert/reorder/delete stages.
- **Evidence**: `loop-orchestrator.ts:17-21`, `computeLoopStages():347-355`
- **Confidence**: 0.82
- **Fix**: Make stage sequence configurable from AgentConfig or plugin registrations.

### N-4 [MEDIUM] No Unified Harness API Surface

- **Mechanism**: observe/control/intervene capabilities scattered across 5+ places with no coherent facade.
- **Confidence**: 0.75
- **Fix**: Extract `HarnessAPI` interface aggregating the three capabilities.

### N-5 [LOW] Compat Rules as Opaque Second LLM Path

- **12-layer map**: Layer 11 (Hidden Repair Loops)
- **Mechanism**: `compat:retry` events now emitted, but `fixHistory()` modifications (deleted reasoning, inserted empty messages, sanitized IDs) remain opaque.
- **Evidence**: `provider-history-compat.ts:155-176`
- **Confidence**: 0.68
- **Fix**: `applyReactiveRules` returns `{ history, diff }`; diff exposed via event/span.

### N-6 [LOW] Three-Form/7-Module/AOP Relationship Undocumented

- **Mechanism**: Perfect theoretical mapping exists but no code or doc expresses it.
- **Confidence**: 0.60
- **Fix**: Add three-form → 7-module mapping to CLAUDE.md or architecture docs.

---

## Ordered Fix Plan

| # | Goal | Why Now | Expected Effect |
|---|------|---------|-----------------|
| 1 | Default CheckpointStore = Jsonl | Crash = state loss unacceptable for production | Out-of-box persistence |
| 2 | Built-in semantic compression | slidingWindow(50) ineffective for long convos | Preserve critical context |
| 3 | Pipeline stage configurability | "Flow as data" promise unfulfilled | Plugins can insert/reorder stages |
| 4 | HarnessAPI aggregation facade | Control/observe/intervene scattered | Single harness facade |
| 5 | Compat diff observability | Need to know what changed, not just that it happened | Full compat transparency |
| 6 | Three-form → 7-module docs | Theory and code aligned, docs missing | Architecture legibility |

---

## Ultimate Judgment

```
Current state:  Capability completeness 7/7  ✅
                Default safety          5/7  ⚠️
                Architecture legibility 3/7  ❌

Target state:   Capability completeness 7/7  ✅
                Default safety          7/7  ✅
                Architecture legibility 7/7  ✅
```

This differs fundamentally from the previous audit: last time was "what functionality is missing"; this time is "all functionality exists but architectural intent hasn't surfaced."

---

## Related

- 2026-05-14 audit: `docs/audit/agent-architecture-audit-2026-05.md`
- 7-Module architecture: project memory `project-production-agent-7-modules`
- Agent design first principles: project memory `project-agent-design-from-first-principles`
- AOP first principles: project memory `project-aop-first-principles`
- Harness first principles: project memory `project-harness-first-principles`
