# Audit Fix Implementation Plan

**Created**: 2026-05-14
**Status**: Complete — all findings resolved

## Batches

### Batch 1: Foundation (F-8 → F-4 → F-1)

#### F-8 EventBus handler error isolation [LOW]
- File: `packages/core/src/event-bus.ts`
- Change: emit() wraps each handler in try/catch
- ~10 lines + test

#### F-4 Stream consumption dedup [MEDIUM]
- File: `packages/core/src/pipeline.ts`
- Change: run() and stream() share parseFullStream helper (already exists as standalone function)
- Refactor only, existing tests must pass

#### F-1 CheckpointStore persistence [HIGH]
- Files:
  1. `packages/sdk/src/index.ts` — add CheckpointStore interface (save/load/delete/list)
  2. `packages/core/src/checkpoint-store.ts` — new file, InMemoryCheckpointStore + JsonlCheckpointStore
  3. `packages/core/src/loop-orchestrator.ts` — inject CheckpointStore, replace internal Map
  4. `packages/core/src/agent.ts` — construct and inject CheckpointStore
- Crash recovery test required

### Batch 2: Observability (F-2 → F-5)

#### F-2 Reactive Compat observability [HIGH]
- File: `packages/core/src/loop-orchestrator.ts`
- Change: emit `compat:retry` event + span attribute before compat retry
- ~15 lines + test

#### F-5 Hook output mutation tracking [MEDIUM]
- File: `packages/core/src/tool-registry.ts`
- Change: emit `tool:output_mutated` or span when hook changes result
- ~10 lines + test

### Batch 3: Pipeline Capabilities (F-3 → F-6)

#### F-3 ContextBuilder compression [HIGH]
- Files:
  1. `packages/sdk/src/index.ts` — add CompressionStrategy interface
  2. `packages/core/src/processors/prepare-step.ts` — inject strategy, replace hard truncation
  3. Built-in SlidingWindowStrategy
  4. `plugins/compression/` as advanced strategy plugin
- Long conversation test (100+ messages)

#### F-6 Tool Requirement Gate [MEDIUM]
- Files:
  1. `packages/sdk/src/index.ts` — AgentConfig add `requiredTools?: string[]`
  2. `packages/core/src/processors/evaluate-iteration.ts` — check requiredTools in toolCalls
- Test: requiredTool missing → emit warning / force continue

### Batch 4: Event System Upgrade (F-7)

#### F-7 EventBus replay [LOW]
- Files:
  1. `packages/core/src/event-bus.ts` — extend to EventSystem (emit + subscribe + replay)
  2. `packages/core/src/session-persistence.ts` — integrate as replay backend
  3. All consumers migrate
- Highest complexity, widest impact surface

## Dependencies

```
F-8 → F-7 (handler isolation is prereq for replay)
F-8 → F-2 (safer EventBus for compat events)
F-1 → F-2 (loop-orchestrator.ts shared, F-1 restructures first)
F-4 independent (pipeline.ts)
F-3 independent (processors/)
F-5 independent (tool-registry.ts)
F-6 independent (evaluate-iteration.ts)
```

## ECC Skills to Use

- Implementation: `ecc:feature-dev` (TDD)
- Review: `ecc:code-review` (after each finding)
- Build fix: `ecc:build-fix` (if needed)
- Refactor: `ecc:refactor-clean` (Batch 4)
- Final: `ecc:quality-gate`

## File Conflicts

| File | Findings | Strategy |
|------|----------|----------|
| loop-orchestrator.ts | F-1 + F-2 | F-1 first (structure), F-2 second (events) |
| event-bus.ts | F-7 + F-8 | F-8 in Batch 1, F-7 in Batch 4 |
| pipeline.ts | F-4 | Independent |
| tool-registry.ts | F-5 | Independent |

## Estimates

| Batch | LOC | New Files | Tests |
|-------|-----|-----------|-------|
| 1 | ~150 | checkpoint-store.ts | 3 |
| 2 | ~40 | none | 2 |
| 3 | ~120 | none (sdk interfaces) | 2 |
| 4 | ~80 | none | 1 |
| **Total** | **~390** | **1** | **8** |

## References

- Full audit report: `docs/audit/agent-architecture-audit-2026-05.md`
- Issues: `.scratch/audit-2026-05/F-1` through `F-8`
- Memory: `project-agentforge-audit-2026-05`
