# P1 Simplification — Design Spec

> Date: 2026-05-05
> Status: Design approved, pending implementation plan
> Reference: docs/design/ANALYSIS-AND-SIMPLIFICATION.md

## Overview

Implement all 5 P1 simplification items in one batch, addressing over-engineering identified in the cross-framework analysis. The goal is simpler architecture without removing functionality.

## P1-1: Flatten AgentContext (8 sub-objects → flat)

### Current state

AgentContext has 8 sub-objects (identity, core, security, controls, memory, resilience, extensions, harness) with 32 total fields. Three builders each construct all 8 sub-objects. `normalizeServices()` in create-agent.ts is 128 lines of mapping from flat overrides to grouped form.

### Design

Flatten all 32 fields to AgentContext top level. Keep all fields, delete no functionality.

```typescript
// BEFORE (8 sub-objects, nested access)
export interface AgentContext {
  identity: AgentIdentity;       // { sessionId, agentName }
  core: AgentCore;               // { llm, tools, memory, pauseController, services, logger? }
  security: AgentSecurity;       // { permissionPolicy?, permissionController?, sandboxExecutor?, auditLogger?, inputSanitizer?, securityGuard? }
  controls: AgentControls;       // { hitl?, rateLimiter?, quota?, checkpoint?, abortSignal? }
  memory: AgentMemoryContext;    // { compactionManager?, workingMemory?, workingMemoryProcessor?, qualityGate? }
  resilience: AgentResilience;   // { errorClassifier?, circuitBreaker?, autoRepairer?, onError? }
  extensions: AgentExtensions;   // { mcpClients?, subagents?, planner? }
  harness: AgentHarness;         // { hookRegistry, pluginManager? }
}

// AFTER (flat, JSDoc-grouped)
export interface AgentContext {
  // Identity
  sessionId: string;
  agentName: string;

  // Core
  llm: LLMAdapter;
  tools: ToolRegistry;
  memory: Memory;
  pauseController: PauseController;
  services: ApplicationServices;
  logger?: Logger;

  // Security
  permissionPolicy?: PermissionPolicy;
  permissionController?: PermissionController;
  sandboxExecutor?: SandboxExecutor;
  auditLogger?: AuditLogger;
  inputSanitizer?: InputSanitizer;
  securityGuard?: SecurityGuard;

  // Controls
  hitl?: HITLController;
  rateLimiter?: RateLimiter;
  quota?: QuotaController;
  checkpoint?: CheckpointController;
  abortSignal?: AbortSignal;

  // Memory
  compactionManager?: CompactionManager;
  workingMemory?: WorkingMemory;
  workingMemoryProcessor?: WorkingMemoryProcessor;
  qualityGate?: QualityGate;

  // Resilience
  errorClassifier?: ErrorClassifier;
  circuitBreaker?: CircuitBreaker;
  autoRepairer?: AutoRepairer;
  onError?: ErrorHandler;

  // Extensions
  mcpClients?: MCPClient[];
  subagents?: SubagentRegistry;
  planner?: Planner;

  // Harness
  hookRegistry: HookRegistry;
  pluginManager?: PluginManager;
}
```

### Changes required

1. **context.ts**: Replace 8 sub-interfaces (AgentIdentity, AgentCore, etc.) + AgentContext with single flat interface. Keep sub-interfaces only if used independently elsewhere (check).
2. **context-builder.ts (L3)**: Delete 8-object construction (lines 129-158), use flat assignment.
3. **context-builder.ts (L2 API)**: Delete 8-object construction + 36 lines of if-assignments (lines 274-370).
4. **create-agent.ts**: Delete `normalizeServices()` (lines 100-229, 128 lines). Delete `FlatServiceOverrides` (lines 57-90). Simplify createAgent() context construction.
5. **All consumers** (~10 files): `ctx.identity.sessionId` → `ctx.sessionId`, `ctx.core.llm` → `ctx.llm`, etc.

### Consumer files to update

- `src/loop/agent-loop.ts` — ~60+ accesses
- `src/loop/llm-caller.ts` — ~15 accesses
- `src/loop/tool-executor.ts` — ~20 accesses
- `src/loop/plan-executor.ts` — ~5 accesses
- `src/loop/error-recovery-handler.ts` — ~5 accesses
- `src/loop/checkpoint-saver.ts` — ~3 accesses
- `src/loop/token-budget.ts` — ~3 accesses
- `src/api/create-agent.ts` — ~10 accesses
- `src/plugins/pipeline.ts` — ~3 accesses
- `tests/` — all mock AgentContext constructions

## P1-2: Reduce event types 31 → ~13

### Design

Remove or merge event types that have no consumers, are redundant, or impose runtime overhead.

**Keep (12)**:
1. `agent.start` — loop entry
2. `agent.complete` — normal completion
3. `agent.error` — error completion
4. `llm.request` — LLM call request
5. `llm.response` — LLM call response
6. `tool.call` — tool execution start (add optional `batchId`)
7. `tool.result` — tool execution result (add optional `batchId`)
8. `state.change` — state transitions (add optional `checkpoint` info)
9. `done` — terminal event
10. `subagent.start` — subagent lifecycle
11. `subagent.complete` — subagent lifecycle
12. `compaction.start` / `compaction.complete` — keep both, used at 2 trigger points

**Remove/Merge**:
- `agent.step` → `agent.complete.stepCount`
- `llm.chunk` → callback-based, not event (high-frequency overhead)
- `file.change` → unused, remove
- `tool.batch.start` / `tool.batch.complete` → `tool.call`/`tool.result` with `batchId` field
- `checkpoint` → `state.change` with `checkpoint` field
- `subagent.error` → `agent.error` with `source: 'subagent'`
- `mcp.connecting`, `mcp.connected`, `mcp.disconnected`, `mcp.error` — no consumers, remove
- `workflow.start`, `workflow.step.start`, `workflow.step.end`, `workflow.complete`, `workflow.error` — no consumers, remove
- `permission.prompt` / `permission.decision` → merge to single `permission` event

### Changes required

1. **events.ts**: 
   - Reduce `AgentEventTypeSchema` from 31 to 12 enum values
   - Reduce `AgentEventSchema` from 31 to 12 discriminated union members (~326 → ~150 lines)
   - Update type guards: remove `isMCPEvent`, `isWorkflowEvent`, `isPermissionEvent`; merge `isCompactionEvent` into `isAgentLifecycleEvent`
2. **agent-loop.ts**: Update event emissions — remove `agent.step`, `tool.batch.*`, `checkpoint`, `file.change`, `permission.*`; replace with merged alternatives
3. **llm-caller.ts**: Remove `llm.chunk` event emission. Add `onChunk?: (chunk: { content: string; toolCallDelta?: unknown }) => void` to LLM call options (not the LLMAdapter interface itself). Streaming callers pass the callback directly; non-streaming unaffected. This avoids Zod validation on every chunk (dozens/sec during streaming).
4. **All event listeners**: Update subscriptions for renamed/merged events

## P1-3: Simplify RequestHookPriority 6 → 3

### Design

Remove 3 unused levels, rename remaining 3 for clarity.

```typescript
// BEFORE
export const RequestHookPriority = {
  SYSTEM_RULES: 10,        // UNUSED — remove
  MEMORY_CONTEXT: 20,      // → MEMORY: 10
  WORKING_MEMORY: 25,      // → WORKING_MEMORY: 20
  SKILL_INSTRUCTIONS: 30,  // → SKILL: 30
  TOOL_DESCRIPTIONS: 40,   // UNUSED — remove
  USER_CUSTOM: 50,         // → DEFAULT_REQUEST_HOOK_PRIORITY = 100 (numeric constant)
} as const;

// AFTER
export const RequestHookPriority = {
  MEMORY: 10,
  WORKING_MEMORY: 20,
  SKILL: 30,
} as const;

export const DEFAULT_REQUEST_HOOK_PRIORITY = 100;
```

### Changes required

1. **hooks.ts**: Replace 6-level `RequestHookPriority` with 3-level version. Add `DEFAULT_REQUEST_HOOK_PRIORITY` constant.
2. **memory-plugin.ts**: `MEMORY_CONTEXT` → `MEMORY`
3. **skills-plugin.ts**: `SKILL_INSTRUCTIONS` → `SKILL`
4. **agent-loop.ts**: `WORKING_MEMORY` → `WORKING_MEMORY` (unchanged logic)
5. **index.ts** (main): Update re-export
6. **memory/index.ts**: Remove `RequestHookPriority` re-export

## P1-4: Unify HookName + LifecyclePhase

### Design

Delete the 15-value `HookName` object (zero references in consumer code — all use raw strings). Extend `LifecyclePhase` to cover all lifecycle cut-points.

```typescript
// BEFORE: Two parallel systems
export const HookName = {
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
  STEP_BEGIN: 'step.begin',
  // ... 15 values total, zero consumers use HookName. prefix
};

export type LifecyclePhase = 'pre-llm' | 'post-llm';

// AFTER: Single unified LifecyclePhase
export type LifecyclePhase =
  | 'session.start' | 'session.end'
  | 'step.begin' | 'step.end'
  | 'pre-llm' | 'post-llm'
  | 'tool.before' | 'tool.after'
  | 'compaction.before' | 'compaction.after'
  | 'error';
```

### Hook execution model

Two functions replace the current split:

```typescript
// Blocking gate checks (checkpoint hooks): returns continue/abort/retry
async function runCheckpointHooks(phase: LifecyclePhase, ctx: AgentContext, state: AgentState): Promise<CheckpointResult>

// Fire-and-forget observation (lifecycle hooks): emits to HookRegistry lifecycle listeners
async function emitLifecycleHooks(phase: LifecyclePhase, ctx: AgentContext, state: AgentState): Promise<void>
```

### Changes required

1. **hooks.ts**: 
   - Delete `HookName` object (lines 80-107)
   - Extend `LifecyclePhase` from 2 to 10 values
   - Update `HookRegistry.lifecycle` Map key type from `string` to `LifecyclePhase`
2. **agent-loop.ts**: Replace all `hookRegistry.emitLifecycle('session.start', ...)` calls — the string literals stay the same but now type-checked against `LifecyclePhase`
3. **pipeline.ts**: Update checkpoint hook registration to use extended `LifecyclePhase`
4. **llm-caller.ts**: Update lifecycle emissions
5. **tool-executor.ts**: Update lifecycle emissions
6. **error-recovery-handler.ts**: Update lifecycle emissions
7. **index.ts**: Remove `HookName` export, add extended `LifecyclePhase`

## P1-5: Clean up sub-path exports

### Design

Reduce 27 sub-paths to ~22 by merging thin modules. Remove internal implementation symbols from all sub-path exports.

**Merge**:
- `./lifecycle` (2 symbols) → `./core`
- `./validation` (3 symbols) → `./contracts`
- `./observability` → `./core`
- `./quota` → `./core`
- `./audit` → `./security`
- `./quickstart` → internal only (remove from exports map)

**Clean each sub-path**:
- `./core`: Remove Zod schema value exports (keep type exports), remove concrete class exports (AgentEventEmitter, ContextBuilder, SimpleToolRegistry, HookRegistry, etc.), keep only interfaces + type guards
- `./api`: Remove re-exports of core internals (ContextBuilder, SimpleToolRegistry, etc.)
- `./plugins`: Remove cross-module re-exports (TodoItem types from tools/)
- `./memory`: Remove RequestHookPriority re-export
- `./resilience`: Remove cross-module re-exports from contracts/

**Add `@internal` JSDoc** to all symbols not intended for public consumption.

### Changes required

1. **package.json**: Remove 5+ sub-path entries from exports map
2. **src/core/index.ts**: Filter exports — remove Zod schema values, concrete classes
3. **src/api/index.ts**: Filter exports — remove internal re-exports
4. **src/plugins/index.ts**: Remove cross-module re-exports
5. **src/memory/index.ts**: Remove RequestHookPriority re-export
6. **src/resilience/index.ts**: Remove cross-module re-exports
7. **Each merged sub-path**: Create re-export shim in target module

## Implementation Order

```
Phase 1: P1-1 (Flatten AgentContext)     — ~10 files, ~200+ access changes
Phase 2: P1-4 (Unify lifecycle)          — hooks.ts + agent-loop.ts + pipeline.ts + 3 files
Phase 3: P1-3 (Simplify priorities)      — hooks.ts + 3 plugin files
Phase 4: P1-2 (Reduce events)            — events.ts + agent-loop.ts + llm-caller.ts
Phase 5: P1-5 (Clean exports)            — package.json + 6 index.ts files
```

## Verification

After each phase:
- `npm run build` — tsc strict must pass
- `npm run test` — all 2478 tests must pass

After all phases:
- `npm run lint` — no lint errors
- Verify main entry exports are still ~69 curated symbols
- Verify sub-path imports still work for legitimate use cases
