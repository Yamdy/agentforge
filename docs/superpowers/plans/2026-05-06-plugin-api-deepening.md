# Phase 3: Plugin API Deepening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plugin API powerful enough to build workflow, A2A, and session persistence as official plugins without modifying the core loop.

**Architecture:** 5 code changes ordered by dependency — LifecyclePhase types first (foundation), then PluginContext expansion + ToolHook unification (API surface), then streaming chunks via emitChunk (additive), then exports restructuring (independent). E2E test suite added throughout.

**Tech Stack:** TypeScript strict, Zod for event validation, Vitest for testing.

**Design spec:** `docs/superpowers/specs/2026-05-06-plugin-api-deepening-design.md`

---

### Task 1: LifecyclePhase 三分法 — Type Definitions

**Files:**
- Modify: `src/core/hooks.ts:212-281`

- [ ] **Step 1: Replace flat LifecyclePhase with three separated types**

Replace lines 206-231 in `src/core/hooks.ts` (the `LifecyclePhase` type definition and surrounding comments):

```typescript
// ============================================================================
// Lifecycle Phase Types (Three Semantically Distinct Categories)
// ============================================================================

/**
 * Checkpoint Phase — blocking hooks that can terminate the agent loop.
 *
 * Used exclusively by CheckpointHook. A hook registered for a CheckpointPhase
 * can return `{ action: 'block' }` to stop the loop.
 *
 * checkpoints run at these two cut-points:
 * - pre-llm: before each LLM call (quota, rate-limit)
 * - post-llm: after each LLM response (quality gate, circuit breaker)
 */
export type CheckpointPhase = 'pre-llm' | 'post-llm';

/**
 * Lifecycle Phase — observational fire-and-forget hooks.
 *
 * Used by LifecycleHookEntry. These hooks observe lifecycle events but
 * CANNOT block the loop. Errors are silently caught.
 */
export type LifecyclePhase =
  | 'session.start'
  | 'session.end'
  | 'step.begin'
  | 'step.end'
  | 'llm.request.before'
  | 'llm.response.after'
  | 'tool.before'
  | 'tool.after'
  | 'compaction.before'
  | 'compaction.after';

/**
 * Recovery Phase — error and recovery lifecycle hooks.
 *
 * Used by RecoveryHookEntry. Triggered when errors occur or recovery
 * actions are taken (escalation, compaction-based recovery, fallback).
 */
export type RecoveryPhase =
  | 'llm.error'
  | 'tool.error'
  | 'recovery.escalate'
  | 'recovery.compact'
  | 'recovery.fallback'
  | 'error';
```

- [ ] **Step 2: Narrow CheckpointHook.phase to CheckpointPhase**

Replace the `CheckpointHook` interface (lines 272-281):

```typescript
/**
 * Checkpoint Hook — registered by plugins to run at checkpoint phases.
 *
 * Unlike lifecycle hooks (fire-and-forget observation), checkpoint hooks
 * can BLOCK the agent loop. This replaces the standalone CheckpointRegistry.
 *
 * Hooks are run in priority order (lower = earlier). Execution stops at the
 * first `{ action: 'block' }` result.
 */
export interface CheckpointHook {
  /** Unique hook name for debugging */
  name: string;
  /** Checkpoint phase when this checkpoint executes (pre-llm or post-llm) */
  phase: CheckpointPhase;
  /** Execution order (lower = earlier) */
  priority: number;
  /** Check function — returns 'continue' or 'block' */
  check: CheckpointFn;
}
```

- [ ] **Step 3: Add LifecycleHookEntry.phase narrowing and RecoveryHookEntry**

Replace the `LifecycleHookEntry` interface (lines 78-83):

```typescript
/**
 * Registered lifecycle hook entry.
 */
export interface LifecycleHookEntry {
  phase: LifecyclePhase;
  fn: HookFn;
  /** Lower number = earlier execution */
  priority: number;
}

/**
 * Registered recovery hook entry.
 */
export interface RecoveryHookEntry {
  phase: RecoveryPhase;
  fn: HookFn;
  /** Lower number = earlier execution */
  priority: number;
}
```

- [ ] **Step 4: Update HookRegistry to support RecoveryPhase**

In `HookRegistry` class, add recovery storage + methods after the lifecycle section (around line 358):

```typescript
  // ── Recovery Hooks ──
  private recovery = new Map<RecoveryPhase, RecoveryHookEntry[]>();

  /**
   * Register a recovery hook.
   */
  onRecovery(phase: RecoveryPhase, fn: HookFn, priority = DEFAULT_REQUEST_HOOK_PRIORITY): () => void {
    const entry: RecoveryHookEntry = { phase, fn, priority };
    const existing = this.recovery.get(phase) ?? [];
    existing.push(entry);
    existing.sort((a, b) => a.priority - b.priority);
    this.recovery.set(phase, existing);
    return () => {
      const arr = this.recovery.get(phase);
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /** Get all recovery hooks for a given phase, sorted by priority. */
  getRecoveryHooks(phase: RecoveryPhase): HookFn[] {
    return (this.recovery.get(phase) ?? []).map(e => e.fn);
  }
```

Also update `clear()` to clear the recovery map:

```typescript
  clear(): void {
    this.lifecycle.clear();
    this.recovery.clear();
    this.requests = [];
    this.tools = [];
    this.toolProviders = [];
  }
```

- [ ] **Step 5: Update `on()` method signature to accept LifecyclePhase**

Change the `on()` method's phase parameter type from the old `LifecyclePhase` to the new `LifecyclePhase`:

```typescript
  on(phase: LifecyclePhase, fn: HookFn, priority = DEFAULT_REQUEST_HOOK_PRIORITY): () => void {
```

- [ ] **Step 6: Update `registerLifecycle` signature**

```typescript
  registerLifecycle(
    hooks: Array<{ phase: LifecyclePhase; fn: HookFn; priority?: number }>
  ): () => void {
```

- [ ] **Step 7: Update `getLifecycleHooks` signature**

```typescript
  getLifecycleHooks(phase: LifecyclePhase): HookFn[] {
```

- [ ] **Step 8: Update exports in hooks.ts comments**

Update the file header comment (lines 8-12) to reflect four hook categories:

```typescript
 * Four hook categories:
 * - LifecycleHook: (input, output) => Promise<void> — observe lifecycle events
 * - RecoveryHook: (input, output) => Promise<void> — observe error/recovery events
 * - RequestHook: modify LLM messages before each call
 * - CheckpointHook: block/continue at checkpoint phases
 * - ToolHook: filter tool definitions + check/modify tool execution
```

- [ ] **Step 9: Compile check**

```bash
npx tsc --noEmit
```

Expected: type errors in files that still reference old `LifecyclePhase` for checkpoint/recovery contexts. This is expected — those will be fixed in subsequent steps.

- [ ] **Step 10: Commit**

```bash
git add src/core/hooks.ts
git commit -m "refactor: split LifecyclePhase into CheckpointPhase, LifecyclePhase, RecoveryPhase

Separate the old 18-value flat enum into three semantically distinct
types: CheckpointPhase (blocking, 2 values), LifecyclePhase
(observational, 10 values), RecoveryPhase (error/recovery, 6 values).

Add RecoveryHookEntry interface and HookRegistry recovery support.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: LifecyclePhase 三分法 — Migrate All Call Sites

**Files:**
- Modify: `src/plugins/plugin.ts`
- Modify: `src/plugins/pipeline.ts`
- Modify: `src/plugins/manager.ts`
- Modify: `src/loop/agent-loop.ts`
- Modify: `src/loop/error-recovery-handler.ts`
- Modify: `src/loop/llm-caller.ts`
- Modify: `src/loop/tool-executor.ts`
- Modify: `src/loop/plan-executor.ts`
- Modify: `src/plugins/builtin-checkpoints.ts`

- [ ] **Step 1: Update plugin.ts — add recoveryHooks to Plugin interface**

In `src/plugins/plugin.ts`, add imports for new types:

```typescript
import type {
  RequestHook,
  ToolHook,
  ToolProviderHook,
  CheckpointHook,
  LifecycleHookEntry,
  RecoveryHookEntry,
  CheckpointPhase,
} from '../core/hooks.js';
```

Then in the `Plugin` interface, add `recoveryHooks` field after `checkpointHooks`:

```typescript
  /** Checkpoint hooks — cross-cutting lifecycle checks that can block the agent loop */
  checkpointHooks?: CheckpointHook[];

  /** Recovery hooks — fire-and-forget observation of error/recovery events */
  recoveryHooks?: RecoveryHookEntry[];
```

- [ ] **Step 2: Update pipeline.ts — handle recoveryHooks and new types**

In `src/plugins/pipeline.ts`, update imports:

```typescript
import type { CheckpointPhase, LifecyclePhase, RecoveryPhase, CheckpointFn } from '../core/hooks.js';
```

Update `getCheckpoints` signature to use `CheckpointPhase`:

```typescript
export interface AppliedPipeline {
  unregister(): void;
  getCheckpoints(phase: CheckpointPhase): CheckpointFn[];
}
```

In `applyPlugins()`, add recovery hook registration. After the checkpoint hooks section (around line 82), add:

```typescript
    // ── Recovery hooks ──
    if (plugin.recoveryHooks) {
      for (const rh of plugin.recoveryHooks) {
        unregisters.push(hookRegistry.onRecovery(rh.phase, rh.fn, rh.priority));
      }
    }
```

Update checkpoint map type to `CheckpointPhase`:

```typescript
const checkpointMap = new Map<CheckpointPhase, Array<{ priority: number; fn: CheckpointFn }>>();
```

Update `getCheckpoints` closure:

```typescript
    getCheckpoints: (phase: CheckpointPhase): CheckpointFn[] => {
      return (checkpointMap.get(phase) ?? []).map(e => e.fn);
    },
```

- [ ] **Step 3: Update manager.ts — getCheckpoints signature**

In `src/plugins/manager.ts`, update import:

```typescript
import type { CheckpointPhase, CheckpointFn } from '../core/hooks.js';
```

Update method signature:

```typescript
  getCheckpoints(phase: CheckpointPhase): CheckpointFn[] {
```

- [ ] **Step 4: Update agent-loop.ts — migrate hooks to new types**

In `src/loop/agent-loop.ts`, update imports at line 31-37:

```typescript
import {
  HookRegistry,
  type CheckpointPhase,
  type LifecyclePhase,
  type RecoveryPhase,
  RequestHookPriority,
  type CheckpointFn,
  CheckpointBlockReason,
} from '../core/hooks.js';
```

Make `runLifecycleHook` function generic with overloaded signatures. Find the `runLifecycleHook` definition (search around line 240-260) and refactor. The function needs to handle three phase types. Update the function signature to accept the union of all three and dispatch to the correct registry method internally. If the current implementation uses a single `hooks.getLifecycleHooks()` call, update it to switch on phase type:

```typescript
    const runLifecycleHook = async (
      phase: LifecyclePhase | CheckpointPhase | RecoveryPhase,
      input: unknown,
      output: unknown
    ): Promise<void> => {
      let hookFns: HookFn[];
      if (phase === 'pre-llm' || phase === 'post-llm') {
        // Checkpoint phases are handled separately via getCheckpoints, not here
        return;
      }
      // Check if it's a recovery phase
      const recoveryPhases: RecoveryPhase[] = [
        'llm.error', 'tool.error', 'recovery.escalate', 'recovery.compact',
        'recovery.fallback', 'error',
      ];
      if ((recoveryPhases as string[]).includes(phase)) {
        hookFns = hooks.getRecoveryHooks(phase as RecoveryPhase);
      } else {
        hookFns = hooks.getLifecycleHooks(phase as LifecyclePhase);
      }
      for (const fn of hookFns) {
        try {
          await fn(input, output);
        } catch {
          // plugin isolation — silently catch
        }
      }
    };
```

Update `preLlmCheckpoints` and `postLlmCheckpoints` to use `CheckpointPhase`:

```typescript
  const preLlmCheckpoints: CheckpointFn[] =
    ctx.pluginManager?.getCheckpoints('pre-llm') ?? config.preLlmCheckpoints ?? [];
  const postLlmCheckpoints: CheckpointFn[] =
    ctx.pluginManager?.getCheckpoints('post-llm') ?? config.postLlmCheckpoints ?? [];
```

- [ ] **Step 5: Update llm-caller.ts — recovery phase references**

In `src/loop/llm-caller.ts`, update import:

```typescript
import type { LifecyclePhase, RecoveryPhase, HookRegistry } from '../core/hooks.js';
```

Update `LLMCallDeps.runLifecycleHook` signature to accept the union type (no code change needed if agent-loop.ts already passes correctly typed function).

The `runLifecycleHook('llm.error', ...)` calls (lines 110 and 285) used `LifecyclePhase` before — now `llm.error` is a `RecoveryPhase`. Since `runLifecycleHook` in agent-loop.ts now handles all three types, these calls need no change.

- [ ] **Step 6: Update tool-executor.ts — tool.error is RecoveryPhase**

In `src/loop/tool-executor.ts`, update import:

```typescript
import type { LifecyclePhase, RecoveryPhase, HookRegistry } from '../core/hooks.js';
```

Update `ToolExecutorDeps.runLifecycleHook` signature:

```typescript
  runLifecycleHook: (
    phase: LifecyclePhase | RecoveryPhase,
    input: unknown,
    output: unknown
  ) => Promise<void>;
```

Search for `tool.error` calls in tool-executor.ts and ensure they work with the new type.

- [ ] **Step 7: Update builtin-checkpoints.ts — phase field type**

In `src/plugins/builtin-checkpoints.ts`, update import:

```typescript
import type { CheckpointPhase } from '../core/hooks.js';
```

The `phase` fields (`'pre-llm'`, `'post-llm'`) are now type-checked against `CheckpointPhase` — no runtime change needed.

- [ ] **Step 8: Update error-recovery-handler.ts**

In `src/loop/error-recovery-handler.ts`, update any `LifecyclePhase` references to use `RecoveryPhase` where appropriate.

- [ ] **Step 9: Update plan-executor.ts**

In `src/loop/plan-executor.ts`, update any `LifecyclePhase` imports. If it calls `runLifecycleHook`, update the phase type.

- [ ] **Step 10: Update main index.ts exports**

In `src/index.ts`, update the Plugin System exports (lines 59-68) to export new types:

```typescript
export type {
  RequestHook,
  ToolHook,
  ToolProviderHook,
  CheckpointHook,
  CheckpointResult,
  CheckpointFn,
  LifecyclePhase,
  CheckpointPhase,
  RecoveryPhase,
  LifecycleHookEntry,
  RecoveryHookEntry,
} from './core/hooks.js';
```

Also update `src/core/index.ts` re-exports if hooks types are re-exported there.

- [ ] **Step 11: Compile and fix remaining type errors**

```bash
npx tsc --noEmit 2>&1 | head -50
```

Fix any remaining type errors. Key areas: test files, any plugin implementations referencing old `LifecyclePhase`.

- [ ] **Step 12: Run tests**

```bash
npm run test
```

Expected: all 2455+ tests pass (some test files may need import updates).

- [ ] **Step 13: Commit**

```bash
git add src/core/hooks.ts src/core/index.ts src/plugins/plugin.ts src/plugins/pipeline.ts src/plugins/manager.ts src/plugins/builtin-checkpoints.ts src/loop/agent-loop.ts src/loop/error-recovery-handler.ts src/loop/llm-caller.ts src/loop/tool-executor.ts src/loop/plan-executor.ts src/index.ts
git commit -m "refactor: migrate all call sites to CheckpointPhase/LifecyclePhase/RecoveryPhase

Update Plugin interface with recoveryHooks, HookRegistry with
onRecovery(), pipeline/manager with narrowed phase types.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: PluginContext 扩展

**Files:**
- Modify: `src/plugins/plugin.ts`
- Modify: `src/plugins/manager.ts` (minor — setContext now requires more fields)
- Modify: `src/api/create-agent.ts` (or wherever createPluginContext is called)
- New: `tests/plugins/plugin-context.spec.ts`

- [ ] **Step 1: Extend PluginContext interface**

In `src/plugins/plugin.ts`, replace the `PluginContext` interface:

```typescript
import type { AgentEvent, AgentEventEmitter } from '../core/events.js';
import type { Message } from '../core/events.js';
import type { AgentState } from '../core/state.js';
import type { ToolDefinition } from '../core/interfaces.js';

export interface PluginContext {
  /** Read-only session identifier */
  readonly sessionId: string;
  /** Read-only agent name */
  readonly agentName: string;
  /** Distributed tracer for observability */
  readonly tracer?: Tracer;
  /** Metrics collector for observability */
  readonly metrics?: Metrics;
  /** Logger for diagnostic output */
  readonly logger?: Logger;

  /** Emit custom events through the agent's event emitter */
  readonly emitter: AgentEventEmitter;

  /** Get a read-only snapshot of the current agent state */
  getState(): Readonly<AgentState>;

  /** List registered tool definitions (read-only — cannot execute) */
  listTools(): ToolDefinition[];

  /** Inject messages into the conversation flow (go through request hook pipeline) */
  addMessages(messages: Message[]): void;
}
```

- [ ] **Step 2: Update createPluginContext factory**

Replace the `CreatePluginContextOptions` interface and `createPluginContext` function:

```typescript
export interface CreatePluginContextOptions {
  sessionId: string;
  agentName: string;
  tracer?: Tracer;
  metrics?: Metrics;
  logger?: Logger;
  emitter: AgentEventEmitter;
  getState: () => Readonly<AgentState>;
  listTools: () => ToolDefinition[];
  addMessages: (messages: Message[]) => void;
}

export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  return {
    sessionId: options.sessionId,
    agentName: options.agentName,
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.tracer !== undefined ? { tracer: options.tracer } : {}),
    ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
    emitter: options.emitter,
    getState: options.getState,
    listTools: options.listTools,
    addMessages: options.addMessages,
  };
}
```

- [ ] **Step 3: Update create-agent.ts to pass new context fields**

In `src/api/create-agent.ts`, find where `createPluginContext` or `PluginManager.setContext` is called. Update to pass the four new capabilities. The exact location depends on the current wiring — search for `createPluginContext(` or `setContext(`.

Add message queue support to agent-loop.ts: a pending messages array that `addMessages` pushes to, consumed at the top of each loop iteration. The agent-loop.ts run closure needs to expose an `addMessages` function that appends to `state.messages` directly.

In `createAgentLoop()`, add near the top:

```typescript
  // Pending message queue for PluginContext.addMessages()
  const pendingMessages: Message[] = [];
```

Then expose `addMessages` function that appends to `state.messages`:

```typescript
  const addMessages = (msgs: Message[]): void => {
    if (state) {
      state.messages.push(...msgs);
    } else {
      pendingMessages.push(...msgs);
    }
  };
```

Update the plugin context creation in `create-agent.ts` to pass:

```typescript
const pluginCtx = createPluginContext({
  sessionId: ctx.sessionId,
  agentName: ctx.agentName,
  tracer: ctx.services?.tracer,
  metrics: ctx.services?.metrics,
  logger: ctx.logger,
  emitter: emitter,
  getState: () => state as Readonly<AgentState>,
  listTools: () => ctx.tools?.list().map(name => ctx.tools!.get(name)).filter(Boolean) as ToolDefinition[],
  addMessages: (msgs) => {
    if (state) {
      state.messages.push(...msgs);
    }
  },
});
```

- [ ] **Step 4: Write tests — plugin-context.spec.ts**

Create `tests/plugins/plugin-context.spec.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentEventEmitter, type AgentEvent } from '../../src/core/events.js';
import { createPluginContext, type PluginContext, type Plugin } from '../../src/plugins/plugin.js';
import { createInitialState } from '../../src/core/state.js';
import { HookRegistry } from '../../src/core/hooks.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';

describe('PluginContext', () => {
  // Shared test fixtures
  let emitter: AgentEventEmitter;
  let getState: () => ReturnType<typeof createInitialState>;
  let state: ReturnType<typeof createInitialState>;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    state = createInitialState({
      sessionId: 'test-session',
      agentName: 'test-agent',
      model: { provider: 'test', model: 'test-model' },
      initialMessages: [],
      maxSteps: 10,
    });
    getState = () => state;
  });

  // --- emitter ---
  describe('emitter', () => {
    it('allows plugin to emit custom events', async () => {
      const received: AgentEvent[] = [];
      emitter.onAny(e => received.push(e));

      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => state,
        listTools: () => [],
        addMessages: () => {},
      });

      await ctx.emitter.emit({
        type: 'state.change',
        timestamp: Date.now(),
        sessionId: 's1',
        from: 'running',
        to: 'paused',
      });

      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0]!.type).toBe('state.change');
    });

    it('allows plugin B to receive events from plugin A', async () => {
      const receivedFromA: AgentEvent[] = [];
      emitter.on('state.change', e => receivedFromA.push(e));

      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => state,
        listTools: () => [],
        addMessages: () => {},
      });

      await ctx.emitter.emit({
        type: 'state.change',
        timestamp: Date.now(),
        sessionId: 's1',
        from: 'running',
        to: 'completed',
      });

      expect(receivedFromA).toHaveLength(1);
    });
  });

  // --- getState ---
  describe('getState()', () => {
    it('returns current agent state snapshot', () => {
      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => state,
        listTools: () => [],
        addMessages: () => {},
      });

      const snapshot = ctx.getState();
      expect(snapshot.sessionId).toBe('test-session');
      expect(snapshot.step).toBe(0);
    });

    it('reflects state changes', () => {
      let currentStep = 0;
      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => ({ ...state, step: currentStep }),
        listTools: () => [],
        addMessages: () => {},
      });

      expect(ctx.getState().step).toBe(0);
      currentStep = 5;
      expect(ctx.getState().step).toBe(5);
    });
  });

  // --- listTools ---
  describe('listTools()', () => {
    it('returns registered tool definitions', () => {
      const tools: ToolDefinition[] = [
        { name: 'read_file', description: 'Read a file', parameters: {} as any, execute: async () => 'ok' },
      ];

      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => state,
        listTools: () => tools,
        addMessages: () => {},
      });

      expect(ctx.listTools()).toHaveLength(1);
      expect(ctx.listTools()[0]!.name).toBe('read_file');
    });
  });

  // --- addMessages ---
  describe('addMessages()', () => {
    it('injects messages into conversation', () => {
      const added: any[] = [];
      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => state,
        listTools: () => [],
        addMessages: (msgs) => added.push(...msgs),
      });

      ctx.addMessages([{ role: 'system', content: 'Continue with step 3' }]);
      expect(added).toHaveLength(1);
      expect(added[0]!.content).toBe('Continue with step 3');
    });

    it('injected messages are visible to downstream consumers', () => {
      const messages: any[] = [];
      const ctx = createPluginContext({
        sessionId: 's1', agentName: 'a1',
        emitter,
        getState: () => state,
        listTools: () => [],
        addMessages: (msgs) => messages.push(...msgs),
      });

      ctx.addMessages([
        { role: 'system', content: 'msg1' },
        { role: 'system', content: 'msg2' },
      ]);

      expect(messages).toHaveLength(2);
      expect(messages.map((m: any) => m.content)).toEqual(['msg1', 'msg2']);
    });
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npx vitest tests/plugins/plugin-context.spec.ts
```

Expected: all tests pass.

- [ ] **Step 6: Run full test suite**

```bash
npm run test
```

Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/plugin.ts src/plugins/manager.ts src/api/create-agent.ts src/loop/agent-loop.ts tests/plugins/plugin-context.spec.ts
git commit -m "feat: expand PluginContext with emitter, getState, listTools, addMessages

Add four new capabilities to PluginContext: emitter for custom events,
getState() for read-only state access, listTools() for tool discovery,
addMessages() for message injection.

These enable plugins to build workflow-like behavior without core
loop modifications.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: ToolProviderHook/ToolHook 统一

**Files:**
- Modify: `src/core/hooks.ts`
- Modify: `src/plugins/plugin.ts`
- Modify: `src/plugins/pipeline.ts`
- Modify: `src/loop/llm-caller.ts`
- Modify: `src/loop/tool-executor.ts`
- Modify: `src/plugins/builtin-checkpoints.ts` (if any tool hooks exist)
- Modify: `tests/core/hooks.spec.ts`
- Modify: `tests/loop/agent-loop.spec.ts`

- [ ] **Step 1: Add ToolBeforeResult type and merge ToolHook interface**

In `src/core/hooks.ts`, after the existing `ToolHook` comment block, replace both `ToolHook` and `ToolProviderHook`:

```typescript
// ============================================================================
// Tool Hook (filter definitions + check/modify before execution)
// ============================================================================

/** Result of a beforeExecute check. */
export type ToolBeforeResult =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'modify'; args: Record<string, unknown> };

/**
 * Tool Hook — unified interface for tool control.
 *
 * Combines the former ToolProviderHook (filtering tool definitions before
 * LLM calls) and ToolHook (checking/modifying tool execution) into a single
 * interface. A ToolHook can implement either or both methods.
 *
 * Use cases:
 * - filter: remove dangerous tools, inject context-specific tools
 * - beforeExecute: permission check, rate-limit, parameter modification
 *
 * Hooks are run in priority order (lower = earlier).
 * - filter: each hook transforms the array, next hook sees the result
 * - beforeExecute: first block/modify wins, remaining hooks skip
 */
export interface ToolHook {
  /** Unique hook name for debugging */
  name: string;
  /** Execution order (lower = earlier) */
  priority: number;

  /**
   * Optional — filter/inject tool definitions before each LLM call.
   *
   * @param tools - Current tool definitions (after previous hooks)
   * @param state - Current agent loop state (read-only reference)
   * @returns Modified tool definitions
   */
  filter?(
    tools: FunctionDefinition[],
    state: AgentState
  ): FunctionDefinition[] | Promise<FunctionDefinition[]>;

  /**
   * Optional — validate or modify a tool call before execution.
   *
   * @param toolCall - The tool call being requested
   * @param state    - Current agent loop state
   * @returns allow, block with reason, or modify with new args
   */
  beforeExecute?(
    toolCall: ToolCall,
    state: AgentState
  ): ToolBeforeResult | Promise<ToolBeforeResult>;
}
```

Remove the old `ToolProviderHook` interface entirely (delete lines 150-200).

- [ ] **Step 2: Update HookRegistry — remove toolProviders, update registerTool/getToolHooks**

In `HookRegistry`:
- Remove the `private toolProviders: ToolProviderHook[]` field
- Remove `registerToolProvider()` and `getToolProviderHooks()` methods
- Keep `private tools: ToolHook[]` and `registerTool()`
- `getToolHooks()` returns `ToolHook[]`
- Add a helper `getToolFilterHooks()` that returns only hooks with `filter`:

```typescript
  getToolFilterHooks(): ToolHook[] {
    return this.tools.filter(h => typeof h.filter === 'function');
  }
```

- [ ] **Step 3: Update plugin.ts — remove toolProviderHooks field**

In `src/plugins/plugin.ts`, remove `toolProviderHooks` from `Plugin` interface. Keep `toolHooks` (the type now includes `filter` and `beforeExecute`).

Update imports to remove `ToolProviderHook`:

```typescript
import type {
  RequestHook,
  ToolHook,
  CheckpointHook,
  LifecycleHookEntry,
  RecoveryHookEntry,
} from '../core/hooks.js';
```

- [ ] **Step 4: Update pipeline.ts — remove toolProviderHooks registration**

In `src/plugins/pipeline.ts`, remove the toolProviderHooks registration block (lines 64-68). The unified `toolHooks` path already registers both `filter` and `beforeExecute` via `hookRegistry.registerTool()`.

- [ ] **Step 5: Update llm-caller.ts — use getToolFilterHooks()**

In `src/loop/llm-caller.ts`, replace the tool provider hook loop (lines 86-89 and 177-179):

```typescript
  // Tool Hooks: per-call dynamic tool injection (filter)
  let toolDefs = ctx.tools?.getFunctionDefs() ?? [];
  for (const h of hooks.getToolFilterHooks()) {
    toolDefs = await h.filter!(toolDefs, st);
  }
```

- [ ] **Step 6: Update tool-executor.ts — handle new beforeExecute return type**

In `src/loop/tool-executor.ts`, replace the current beforeExecute loop (lines 98-115):

```typescript
  // ToolHook: permission check with modify support
  let modifiedArgs = tc.args;
  for (const h of hooks.getToolHooks()) {
    if (!h.beforeExecute) continue;

    const result = await h.beforeExecute({ ...tc, args: modifiedArgs }, state!);

    if (result.action === 'block') {
      const deniedMsg: Message = {
        role: 'tool',
        content: `Permission denied for tool: ${tc.name} (reason: ${result.reason})`,
        toolCallId: tc.id,
        name: tc.name,
      };
      // Audit blocked tool
      ctx.auditLogger?.append({
        sessionId: ctx.sessionId,
        agentName: ctx.agentName,
        eventType: 'tool.call',
        action: 'tool.call',
        resource: tc.name,
        result: 'denied',
        details: { toolCallId: tc.id, reason: result.reason },
      });
      emitToolResult(extractText(deniedMsg.content), true);
      return deniedMsg;
    }

    if (result.action === 'modify') {
      modifiedArgs = result.args;
    }
    // 'allow' — continue to next hook
  }

  // Use potentially modified args
  if (modifiedArgs !== tc.args) {
    tc = { ...tc, args: modifiedArgs };
  }
```

Remove the old `blocked` boolean variable — the `action` discriminated union handles it.

- [ ] **Step 7: Update agent-loop.spec.ts**

In `tests/loop/agent-loop.spec.ts`, update any mock tool hooks to use the new `ToolHook` interface with `filter?` and `beforeExecute?` returning `ToolBeforeResult`.

If a mock hook returns `true`/`false` from `beforeExecute`, change to `{ action: 'allow' }` / `{ action: 'block', reason: 'test' }`.

- [ ] **Step 8: Update hooks.spec.ts**

In `tests/core/hooks.spec.ts`, add tests for unified `ToolHook`:

```typescript
describe('ToolHook (unified)', () => {
  it('filter removes tools', async () => {
    const hook: ToolHook = {
      name: 'filter',
      priority: 10,
      filter: (tools) => tools.filter(t => t.name !== 'dangerous'),
    };
    const tools = [
      { name: 'safe', description: '', parameters: {} as any },
      { name: 'dangerous', description: '', parameters: {} as any },
    ];
    const result = await hook.filter!(tools, {} as AgentState);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('safe');
  });

  it('beforeExecute allows', async () => {
    const hook: ToolHook = {
      name: 'allow',
      priority: 10,
      beforeExecute: () => ({ action: 'allow' }),
    };
    const result = await hook.beforeExecute!(
      { id: '1', name: 'test', args: {} },
      {} as AgentState
    );
    expect(result.action).toBe('allow');
  });

  it('beforeExecute blocks', async () => {
    const hook: ToolHook = {
      name: 'block',
      priority: 10,
      beforeExecute: () => ({ action: 'block', reason: 'not allowed' }),
    };
    const result = await hook.beforeExecute!(
      { id: '1', name: 'test', args: {} },
      {} as AgentState
    );
    expect(result).toEqual({ action: 'block', reason: 'not allowed' });
  });

  it('beforeExecute modifies args', async () => {
    const hook: ToolHook = {
      name: 'modify',
      priority: 10,
      beforeExecute: (tc) => ({
        action: 'modify',
        args: { ...tc.args, injected: true },
      }),
    };
    const result = await hook.beforeExecute!(
      { id: '1', name: 'test', args: { original: 1 } },
      {} as AgentState
    );
    expect(result).toEqual({
      action: 'modify',
      args: { original: 1, injected: true },
    });
  });
});
```

- [ ] **Step 9: Compile check and fix errors**

```bash
npx tsc --noEmit
```

Fix any type errors in plugin implementations or test files still using the old `ToolProviderHook` interface.

- [ ] **Step 10: Run tests**

```bash
npm run test
```

- [ ] **Step 11: Commit**

```bash
git add src/core/hooks.ts src/plugins/plugin.ts src/plugins/pipeline.ts src/loop/llm-caller.ts src/loop/tool-executor.ts tests/core/hooks.spec.ts tests/loop/agent-loop.spec.ts
git commit -m "refactor: unify ToolProviderHook and ToolHook into single ToolHook interface

Merge two separate tool control mechanisms into one interface with
optional filter() and beforeExecute() methods. beforeExecute now
returns discriminated union {action: allow|block|modify}.

Allows injected tools to pass through the same beforeExecute check,
fixing the old bug where ToolProviderHook-injected tools skipped
permission validation.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Streaming chunks via emitChunk

**Files:**
- Modify: `src/core/events.ts`
- Modify: `src/loop/llm-caller.ts`
- Modify: `src/loop/event-iterator.ts`
- Modify: `src/loop/agent-loop.ts`
- New tests in: `tests/core/events.spec.ts`

- [ ] **Step 1: Add emitChunk to AgentEventEmitter**

In `src/core/events.ts`, add the `LLMChunkEvent` TS type and `emitChunk` method. Add after the `AgentEvent` type definition (around line 313):

```typescript
// ============================================================
// Streaming Chunk Event (lightweight — no Zod validation)
// ============================================================

/**
 * Lightweight streaming chunk event.
 *
 * Intentionally NOT in AgentEventTypeSchema z.enum — chunks bypass Zod
 * validation for performance (streaming fires 10s of times per second).
 * TypeScript types provide sufficient safety for the simple delta structure.
 */
export interface LLMChunkEvent {
  type: 'llm.chunk';
  delta: string;
  index: number;
  timestamp: number;
  sessionId: string;
}
```

Add `emitChunk` and `on` overload to `AgentEventEmitter`. Inside the class, after the `emit` method:

```typescript
  private chunkListeners = new Set<(chunk: LLMChunkEvent) => void | Promise<void>>();

  /**
   * Emit a streaming text chunk through the fast path (no Zod validation).
   *
   * Chunks are high-frequency events during streaming. Zod validation
   * overhead would be measurable at 10+ chunks/second.
   */
  emitChunk(delta: string, metadata?: { index?: number }): void {
    const chunk: LLMChunkEvent = {
      type: 'llm.chunk',
      delta,
      index: metadata?.index ?? 0,
      timestamp: Date.now(),
      sessionId: '',
    };
    for (const fn of this.chunkListeners) {
      Promise.resolve()
        .then(() => fn(chunk))
        .catch((err: unknown) => {
          this.logger?.warn('Chunk listener error', { error: serializeError(err) });
        });
    }
  }

  /**
   * Subscribe to chunk events. Overload: when type is 'llm.chunk', handler
   * receives LLMChunkEvent (unvalidated).
   */
  onChunk(fn: (chunk: LLMChunkEvent) => void | Promise<void>): () => void {
    this.chunkListeners.add(fn);
    return () => {
      this.chunkListeners.delete(fn);
    };
  }
```

Update the `clear()` method to also clear chunk listeners:

```typescript
  clear(): void {
    this.typed.clear();
    this.any.clear();
    this.chunkListeners.clear();
  }
```

- [ ] **Step 2: Wire onChunk callback → emitter.emitChunk**

In `src/loop/llm-caller.ts`, update `performStreamingLLMCall`. Replace the `onChunk?.()` call in the text delta handling (line 202):

```typescript
      // Text delta — lightweight callback + emitter fast path
      if (chunk.text) {
        textContent += chunk.text;
        onChunk?.({ content: chunk.text });
        emitter.emitChunk(chunk.text, { index: textContent.length - chunk.text.length });
      }
```

- [ ] **Step 3: Update bridgeEmitterToGenerator for chunk events**

In `src/loop/event-iterator.ts`, update `bridgeEmitterToGenerator`. Since `emitChunk` is a separate method from `emit`, the current interceptor pattern (monkey-patching `emitter.emit`) won't catch chunks. Add chunk interception:

```typescript
export async function* bridgeEmitterToGenerator(
  deps: EventIteratorDeps,
  run: (input: string) => Promise<RunResult>,
  input: string
): AsyncGenerator<AgentEvent | LLMChunkEvent, RunResult, void> {
  // ... existing code ...

  const origEmit = emitter.emit.bind(emitter);
  const origEmitChunk = emitter.emitChunk.bind(emitter);

  emitter.emit = async (event: AgentEvent): Promise<void> => {
    eventQueue.push(event);
    if (eventPushResolve) {
      eventPushResolve();
      eventPushResolve = null;
    }
    await origEmit(event);
  };

  emitter.emitChunk = (delta: string, metadata?: { index?: number }): void => {
    const chunk: LLMChunkEvent = {
      type: 'llm.chunk',
      delta,
      index: metadata?.index ?? 0,
      timestamp: Date.now(),
      sessionId,
    };
    eventQueue.push(chunk as unknown as AgentEvent);
    if (eventPushResolve) {
      eventPushResolve();
      eventPushResolve = null;
    }
    origEmitChunk(delta, metadata);
  };

  // ... rest of function ...

  } finally {
    emitter.emit = origEmit;
    emitter.emitChunk = origEmitChunk;
    if (!runDone) {
      cancelLoop();
    }
  }
}
```

Update import at top:

```typescript
import type { AgentEvent, AgentEventEmitter, SerializedError, LLMChunkEvent } from '../core/events.js';
```

- [ ] **Step 4: Update agent-loop.ts iterate() return type**

In `src/loop/agent-loop.ts`, update the `iterate` method's return type to include `LLMChunkEvent`:

```typescript
  iterate(input: string): AsyncGenerator<AgentEvent | LLMChunkEvent, RunResult, void>;
```

Add import:

```typescript
import {
  type AgentEvent,
  type Message,
  type SerializedError,
  type LLMChunkEvent,
  AgentEventEmitter,
  serializeError,
  generateId,
} from '../core/events.js';
```

- [ ] **Step 5: Write streaming tests**

Add to `tests/core/events.spec.ts`:

```typescript
import { AgentEventEmitter, type LLMChunkEvent } from '../../src/core/events.js';

describe('AgentEventEmitter.emitChunk', () => {
  it('delivers chunks to onChunk subscribers', () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];

    emitter.onChunk(chunk => received.push(chunk));
    emitter.emitChunk('hello', { index: 0 });
    emitter.emitChunk(' world', { index: 1 });

    expect(received).toHaveLength(2);
    expect(received[0]!.delta).toBe('hello');
    expect(received[0]!.index).toBe(0);
    expect(received[1]!.delta).toBe(' world');
  });

  it('does not trigger typed event listeners', () => {
    const emitter = new AgentEventEmitter();
    const typedReceived: any[] = [];
    const chunkReceived: LLMChunkEvent[] = [];

    emitter.on('llm.request', () => typedReceived.push('typed'));
    emitter.onChunk(chunk => chunkReceived.push(chunk));

    emitter.emitChunk('test', { index: 0 });

    expect(typedReceived).toHaveLength(0);
    expect(chunkReceived).toHaveLength(1);
  });

  it('onChunk returns unsubscribe function', () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];

    const unsub = emitter.onChunk(chunk => received.push(chunk));
    emitter.emitChunk('first');
    unsub();
    emitter.emitChunk('second');

    expect(received).toHaveLength(1);
    expect(received[0]!.delta).toBe('first');
  });

  it('listener errors do not crash other listeners', () => {
    const emitter = new AgentEventEmitter();
    const received: LLMChunkEvent[] = [];

    emitter.onChunk(() => { throw new Error('boom'); });
    emitter.onChunk(chunk => received.push(chunk));

    expect(() => emitter.emitChunk('test')).not.toThrow();
    expect(received).toHaveLength(1);
  });

  it('handles 10000 chunks (performance smoke test)', () => {
    const emitter = new AgentEventEmitter();
    let count = 0;
    emitter.onChunk(() => { count++; });

    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      emitter.emitChunk('x', { index: i });
    }
    const elapsed = Date.now() - start;

    expect(count).toBe(10000);
    // 10000 synchronous chunk emissions should complete well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
npx vitest tests/core/events.spec.ts -t "emitChunk"
```

Expected: all chunk tests pass.

- [ ] **Step 7: Run full test suite**

```bash
npm run test
```

- [ ] **Step 8: Commit**

```bash
git add src/core/events.ts src/loop/llm-caller.ts src/loop/event-iterator.ts src/loop/agent-loop.ts tests/core/events.spec.ts
git commit -m "feat: add emitChunk fast path for streaming chunks through event system

AgentEventEmitter gains emitChunk() and onChunk() for lightweight
streaming chunk delivery without Zod validation overhead. onChunk
callback in performStreamingLLMCall now forwards to emitter.emitChunk(),
making chunks subscribable by plugins via eventSubscriptions.

bridgeEmitterToGenerator() intercepts chunks for iterate() generator.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Sub-path Exports 重构

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts`
- New: `src/extensions/index.ts`
- Modify: `src/security/index.ts`
- Modify: `src/memory/index.ts`
- Modify: `src/api/index.ts`
- Modify: `src/core/index.ts`
- Modify: `src/plugins/index.ts`
- Update imports in: ~20 test files

- [ ] **Step 1: Create src/extensions/index.ts**

```typescript
/**
 * Extensions — subagent, MCP, skill
 *
 * @module agentforge/extensions
 */

// Subagent
export { SubagentRegistry, createSubagentRegistry } from '../subagent/index.js';
export type { SubagentDefinition, SubagentResult } from '../subagent/types.js';

// MCP
export { MCPClient } from '../mcp/index.js';
export type { MCPClientConfig, MCPTool } from '../mcp/index.js';

// Skill
export { SkillRegistry, createSkillRegistry } from '../skill/index.js';
export type { SkillDefinition, SkillLoadResult } from '../skill/index.js';
```

Verify which exports exist in subagent/mcp/skill by checking each `index.ts`.

- [ ] **Step 2: Update re-export files**

Update `src/security/index.ts` to re-export sandbox and audit. Check existing exports first, then add:

```typescript
// Re-exports from sandbox/
export { createSandboxExecutor, DockerSandbox, ProcessSandbox } from '../sandbox/index.js';
export type { SandboxExecutor } from '../sandbox/index.js';

// Re-exports from audit/
export { SqliteAuditStore, HashChain } from '../audit/index.js';
export type { AuditStore } from '../audit/index.js';
```

Similarly update `src/memory/index.ts` for storage, `src/api/index.ts` for l1/app/integration, `src/core/index.ts` for lifecycle/observability, `src/plugins/index.ts` for quota.

- [ ] **Step 3: Rewrite package.json exports**

Replace the exports field:

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./api": {
    "types": "./dist/api/index.d.ts",
    "import": "./dist/api/index.js"
  },
  "./core": {
    "types": "./dist/core/index.d.ts",
    "import": "./dist/core/index.js"
  },
  "./loop": {
    "types": "./dist/loop/index.d.ts",
    "import": "./dist/loop/index.js"
  },
  "./plugins": {
    "types": "./dist/plugins/index.d.ts",
    "import": "./dist/plugins/index.js"
  },
  "./adapters": {
    "types": "./dist/adapters/index.d.ts",
    "import": "./dist/adapters/index.js"
  },
  "./contracts": {
    "types": "./dist/contracts/index.d.ts",
    "import": "./dist/contracts/index.js"
  },
  "./security": {
    "types": "./dist/security/index.d.ts",
    "import": "./dist/security/index.js"
  },
  "./memory": {
    "types": "./dist/memory/index.d.ts",
    "import": "./dist/memory/index.js"
  },
  "./extensions": {
    "types": "./dist/extensions/index.d.ts",
    "import": "./dist/extensions/index.js"
  },
  "./planning": {
    "types": "./dist/planning/index.d.ts",
    "import": "./dist/planning/index.js"
  },
  "./resilience": {
    "types": "./dist/resilience/index.d.ts",
    "import": "./dist/resilience/index.js"
  },
  "./evaluation": {
    "types": "./dist/evaluation/index.d.ts",
    "import": "./dist/evaluation/index.js"
  }
}
```

Removed from exports (no longer accessible via sub-path): `./l1`, `./app`, `./storage`, `./sandbox`, `./audit`, `./skill`, `./mcp`, `./a2a`, `./subagent`, `./workflow`, `./integration`, `./validation`, `./observability`, `./lifecycle`, `./quota`, `./quickstart`.

- [ ] **Step 4: Update src/index.ts sub-path documentation**

Replace lines 6-34 with updated sub-path list:

```typescript
 *   agentforge/api          — Agent creation, builders, run helpers (L1 + L2)
 *   agentforge/adapters     — LLM provider adapters (OpenAI, Anthropic, Google, Ollama)
 *   agentforge/plugins      — Plugin system, built-in plugins, plugin loader, quota
 *   agentforge/core         — Core interfaces, events, state, hooks, lifecycle, observability
 *   agentforge/loop         — Agent loop factory (createAgentLoop)
 *   agentforge/extensions   — Subagent delegation, MCP client, skill system
 *   agentforge/planning     — Task planning engine
 *   agentforge/memory       — Compaction, vector stores, semantic memory, storage
 *   agentforge/security     — Security guard, sandbox executor, permission, audit, validation
 *   agentforge/resilience   — Circuit breaker, error classifier, auto-repairer
 *   agentforge/evaluation   — LLM-based evaluation framework
 *   agentforge/contracts    — Zod contracts with graceful degradation
```

- [ ] **Step 5: Find and update test imports**

```bash
grep -r "from '.*agentforge/l1'" tests/ --files-with-matches
grep -r "from '.*agentforge/sandbox'" tests/ --files-with-matches
grep -r "from '.*agentforge/audit'" tests/ --files-with-matches
grep -r "from '.*agentforge/skill'" tests/ --files-with-matches
grep -r "from '.*agentforge/mcp'" tests/ --files-with-matches
grep -r "from '.*agentforge/a2a'" tests/ --files-with-matches
grep -r "from '.*agentforge/subagent'" tests/ --files-with-matches
grep -r "from '.*agentforge/storage'" tests/ --files-with-matches
grep -r "from '.*agentforge/observability'" tests/ --files-with-matches
grep -r "from '.*agentforge/lifecycle'" tests/ --files-with-matches
```

Update each test file:
- `agentforge/l1` → `agentforge/api`
- `agentforge/sandbox` or `agentforge/audit` → `agentforge/security`
- `agentforge/skill` or `agentforge/mcp` or `agentforge/subagent` → `agentforge/extensions`
- `agentforge/storage` → `agentforge/memory`
- `agentforge/observability` or `agentforge/lifecycle` → `agentforge/core`

- [ ] **Step 6: Build to verify no broken exports**

```bash
npm run build
```

Expected: build succeeds. Fix any import errors.

- [ ] **Step 7: Run tests**

```bash
npm run test
```

Expected: all tests pass with updated import paths.

- [ ] **Step 8: Commit**

```bash
git add package.json src/index.ts src/extensions/index.ts src/security/index.ts src/memory/index.ts src/api/index.ts src/core/index.ts src/plugins/index.ts
git add tests/
git commit -m "refactor: restructure sub-path exports 22→12

Merge related modules by semantic domain:
- l1/app/integration/quickstart → api
- sandbox/audit/validation → security
- skill/mcp/subagent → extensions (new)
- storage → memory
- lifecycle/observability → core
- quota → plugins

Remove ./a2a and ./workflow from exports (Phase 4 plugins).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: E2E Plugin Composition Tests

**Files:**
- New: `tests/plugins/plugin-composition.spec.ts`
- New: `tests/plugins/plugin-e2e-scenarios.spec.ts`

- [ ] **Step 1: Write plugin-composition.spec.ts**

Create `tests/plugins/plugin-composition.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventEmitter, type AgentEvent, type LLMChunkEvent } from '../../src/core/events.js';
import { HookRegistry, type CheckpointPhase, type LifecyclePhase, type RecoveryPhase } from '../../src/core/hooks.js';
import { createPluginContext, type Plugin, type PluginContext } from '../../src/plugins/plugin.js';
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { createInitialState, type AgentState } from '../../src/core/state.js';

describe('Plugin Composition', () => {
  let emitter: AgentEventEmitter;
  let hooks: HookRegistry;
  let state: AgentState;
  let pluginCtx: PluginContext;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    hooks = new HookRegistry();
    state = createInitialState({
      sessionId: 'comp-test',
      agentName: 'comp-agent',
      model: { provider: 'test', model: 'test-model' },
      initialMessages: [],
      maxSteps: 10,
    });
    pluginCtx = createPluginContext({
      sessionId: 'comp-test',
      agentName: 'comp-agent',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: (msgs) => { state.messages.push(...msgs); },
    });
  });

  it('three plugins coexist without interference', async () => {
    const quotaPlugin: Plugin = {
      name: 'quota',
      enabled: true,
      checkpointHooks: [{
        name: 'quota-check',
        phase: 'pre-llm' as CheckpointPhase,
        priority: 10,
        check: async () => ({ action: 'continue' as const }),
      }],
    };

    const customPlugin: Plugin = {
      name: 'custom',
      enabled: true,
      requestHooks: [{
        name: 'inject-context',
        priority: 20,
        apply: (msgs) => [...msgs, { role: 'system' as const, content: 'injected' }],
      }],
      eventSubscriptions: [{
        event: 'llm.request',
        handler: () => { /* observe */ },
      }],
    };

    const loggingPlugin: Plugin = {
      name: 'logging',
      enabled: true,
      lifecycleHooks: [{
        phase: 'step.begin' as LifecyclePhase,
        fn: () => { /* log */ },
        priority: 100,
      }],
    };

    const pipeline = applyPlugins([quotaPlugin, customPlugin, loggingPlugin], hooks, emitter, pluginCtx);

    // All three plugins should register their hooks
    const checkpoints = pipeline.getCheckpoints('pre-llm');
    expect(checkpoints).toHaveLength(1);

    const requestHooks = hooks.getRequestHooks();
    expect(requestHooks).toHaveLength(1);
    expect(requestHooks[0]!.name).toBe('inject-context');

    pipeline.unregister();
  });

  it('plugin A events reach plugin B', async () => {
    const received: AgentEvent[] = [];

    const pluginB: Plugin = {
      name: 'observer',
      enabled: true,
      eventSubscriptions: [{
        event: 'state.change',
        handler: (e) => { received.push(e); },
      }],
    };

    applyPlugins([pluginB], hooks, emitter, pluginCtx);

    // Plugin A (simulated external emitter usage via ctx.emitter)
    await pluginCtx.emitter.emit({
      type: 'state.change',
      timestamp: Date.now(),
      sessionId: 'comp-test',
      from: 'running',
      to: 'paused',
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('state.change');
  });

  it('addMessages and requestHooks compose correctly', async () => {
    const stateMessages: any[] = [];
    const localState = { ...state, messages: stateMessages };

    const ctx = createPluginContext({
      sessionId: 's1', agentName: 'a1',
      emitter,
      getState: () => localState,
      listTools: () => [],
      addMessages: (msgs) => { localState.messages.push(...msgs); },
    });

    const plugin: Plugin = {
      name: 'workflow',
      enabled: true,
      requestHooks: [{
        name: 'dedup',
        priority: 10,
        apply: (msgs) => {
          // Remove duplicate system messages
          const seen = new Set<string>();
          return msgs.filter(m => {
            if (m.role !== 'system') return true;
            const key = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        },
      }],
    };

    applyPlugins([plugin], hooks, emitter, ctx);

    // Simulate workflow plugin injecting messages
    ctx.addMessages([{ role: 'system', content: 'Step 1' }]);
    ctx.addMessages([{ role: 'system', content: 'Step 2' }]);
    ctx.addMessages([{ role: 'system', content: 'Step 1' }]); // duplicate!

    // requestHook should have deduped
    const result = hooks.getRequestHooks()[0]!.apply(localState.messages, localState);
    const systemMessages = result.filter(m => m.role === 'system');
    expect(systemMessages).toHaveLength(2); // Step 1, Step 2 (no duplicate)
  });
});
```

- [ ] **Step 2: Write plugin-e2e-scenarios.spec.ts**

Create `tests/plugins/plugin-e2e-scenarios.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventEmitter } from '../../src/core/events.js';
import { HookRegistry } from '../../src/core/hooks.js';
import { createPluginContext, type Plugin, type PluginContext } from '../../src/plugins/plugin.js';
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { createInitialState, type AgentState } from '../../src/core/state.js';

describe('Plugin API: Mini-workflow as Plugin', () => {
  let emitter: AgentEventEmitter;
  let hooks: HookRegistry;
  let state: AgentState;
  let ctx: PluginContext;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    hooks = new HookRegistry();
    state = createInitialState({
      sessionId: 'wf-test',
      agentName: 'wf-agent',
      model: { provider: 'test', model: 'test-model' },
      initialMessages: [{ role: 'user', content: 'Build a calculator' }],
      maxSteps: 10,
    });
    ctx = createPluginContext({
      sessionId: 'wf-test',
      agentName: 'wf-agent',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: (msgs) => { state.messages.push(...msgs); },
    });
  });

  it('workflow plugin emits step events that observer plugin receives', async () => {
    const stepEvents: Array<{ step: number }> = [];

    const workflowPlugin: Plugin = {
      name: 'mini-workflow',
      enabled: true,
      state: { currentStep: 0 },
      lifecycleHooks: [{
        phase: 'step.begin',
        fn: async () => {
          const pluginState = workflowPlugin.state as { currentStep: number };
          pluginState.currentStep++;
          await ctx.emitter.emit({
            type: 'state.change',
            timestamp: Date.now(),
            sessionId: 'wf-test',
            from: 'running',
            to: 'running',
            checkpoint: {
              id: `step-${pluginState.currentStep}`,
              position: 'before_llm',
            },
          });
        },
        priority: 10,
      }],
    };

    const observerPlugin: Plugin = {
      name: 'observer',
      enabled: true,
      eventSubscriptions: [{
        event: 'state.change',
        handler: (event) => {
          if (event.checkpoint) {
            stepEvents.push({ step: parseInt(event.checkpoint.id.split('-')[1]!) });
          }
        },
      }],
    };

    applyPlugins([workflowPlugin, observerPlugin], hooks, emitter, ctx);

    // Simulate 3 steps
    for (let i = 0; i < 3; i++) {
      state.step = i;
      const lifecycleFns = hooks.getLifecycleHooks('step.begin');
      for (const fn of lifecycleFns) {
        await fn({ step: i }, {});
      }
    }

    expect(stepEvents).toHaveLength(3);
    expect(stepEvents.map(e => e.step)).toEqual([1, 2, 3]);
  });

  it('getState reflects current step in lifecycle hook', async () => {
    const observedSteps: number[] = [];

    const plugin: Plugin = {
      name: 'state-reader',
      enabled: true,
      lifecycleHooks: [{
        phase: 'step.begin',
        fn: async () => {
          observedSteps.push(ctx.getState().step);
        },
        priority: 10,
      }],
    };

    applyPlugins([plugin], hooks, emitter, ctx);

    for (let i = 0; i < 5; i++) {
      state.step = i;
      const fns = hooks.getLifecycleHooks('step.begin');
      for (const fn of fns) {
        await fn({ step: i }, {});
      }
    }

    expect(observedSteps).toEqual([0, 1, 2, 3, 4]);
  });
});
```

- [ ] **Step 3: Run new tests**

```bash
npx vitest tests/plugins/plugin-composition.spec.ts tests/plugins/plugin-e2e-scenarios.spec.ts
```

Expected: all pass.

- [ ] **Step 4: Run full test suite**

```bash
npm run test
```

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/plugin-composition.spec.ts tests/plugins/plugin-e2e-scenarios.spec.ts
git commit -m "test: add e2e plugin composition and scenario tests

Verify that multiple plugins coexist in a single agent run, addMessages
and requestHooks compose correctly, events from one plugin reach another,
and mini-workflow pattern works purely via Plugin API.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Final Integration & Verification

**Files:**
- All previously modified files
- Run: `npm run build`, `npm run test`, `npm run lint`

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: zero errors.

- [ ] **Step 2: Full test suite**

```bash
npm run test
```

Expected: all tests pass (2455+ plus new tests).

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Fix any lint issues.

- [ ] **Step 4: Verify no broken imports in downstream consumers**

```bash
grep -r "from '.*agentforge/l1'" tests/ src/ --include="*.ts" && echo "WARNING: stale l1 imports found" || echo "OK: no stale l1 imports"
grep -r "from '.*agentforge/a2a'" tests/ src/ --include="*.ts" && echo "WARNING: stale a2a imports found" || echo "OK: no stale a2a imports"
grep -r "from '.*agentforge/workflow'" tests/ src/ --include="*.ts" && echo "WARNING: stale workflow imports found" || echo "OK: no stale workflow imports"
grep -r "ToolProviderHook" src/ --include="*.ts" && echo "WARNING: old ToolProviderHook references found" || echo "OK: no stale ToolProviderHook"
```

- [ ] **Step 5: Final commit for Phase 3**

```bash
git add -A
git commit -m "chore: finalize Phase 3 Plugin API deepening

LifecyclePhase split into CheckpointPhase/LifecyclePhase/RecoveryPhase.
PluginContext expanded with emitter, getState, listTools, addMessages.
ToolProviderHook and ToolHook unified into single ToolHook interface.
Streaming chunks routed through emitter.emitChunk() fast path.
Sub-path exports restructured 22→12 by semantic domain.
E2E plugin composition and mini-workflow scenario tests added.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
