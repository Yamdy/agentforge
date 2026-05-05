# P1 Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify 5 over-engineered subsystems identified in cross-framework analysis — flatten AgentContext, unify lifecycle hooks, simplify priorities, reduce event types, and clean sub-path exports.

**Architecture:** Five sequential phases, each mechanical and verifiable via `npm run build` + `npm run test`. P1-1 (flatten context) runs first since all other phases depend on flat `ctx.X` access. Each phase is a self-contained set of changes that should not break tests if done precisely.

**Tech Stack:** TypeScript 5.x strict, Zod, Vitest

---

### Task 1: Flatten AgentContext (P1-1)

**Files:**
- Modify: `src/core/context.ts` — replace 8 sub-interfaces + AgentContext with single flat interface
- Modify: `src/core/context-builder.ts` — delete 8-object construction, use flat assignment
- Modify: `src/api/context-builder.ts` — delete 8-object construction + 36 lines of if-assignments
- Modify: `src/api/create-agent.ts` — delete `normalizeServices()` (lines 57-229), delete `FlatServiceOverrides`, simplify `createAgent()` context construction
- Modify: `src/loop/agent-loop.ts` — `ctx.identity.X` → `ctx.X`, `ctx.core.X` → `ctx.X`, etc.
- Modify: `src/loop/llm-caller.ts` — same pattern
- Modify: `src/loop/tool-executor.ts` — same pattern
- Modify: `src/loop/plan-executor.ts` — same pattern
- Modify: `src/loop/error-recovery-handler.ts` — same pattern
- Modify: `src/loop/checkpoint-saver.ts` — same pattern
- Modify: `src/index.ts` — update AgentContext type export (no structural change needed)
- Modify: `tests/` — update all mock AgentContext constructions

- [ ] **Step 1: Rewrite AgentContext in context.ts as flat interface**

Replace the 8 sub-interfaces (lines 117-195) and the `AgentContext` interface with a single flat interface. Keep all 32 fields, just remove nesting.

Open `src/core/context.ts`. Delete lines 117-195 (all sub-interfaces + AgentContext). Replace with:

```typescript
/**
 * Agent Context
 *
 * Created per agent session, contains session-specific state and dependencies.
 * All fields are optional unless marked otherwise.
 */
export interface AgentContext {
  // Identity
  sessionId: string;
  agentName: string;

  // Core (required)
  llm: LLMAdapter;
  tools: ToolRegistry;
  memory: MemoryStore;
  pauseController: PauseController;
  services: ApplicationServices;
  logger?: Logger;

  // Security (optional)
  permissionPolicy?: PermissionPolicy;
  permissionController?: PermissionController;
  sandboxExecutor?: SandboxExecutor;
  auditLogger?: AuditLogger;
  inputSanitizer?: InputSanitizer;
  securityGuard?: SecurityGuard;

  // Controls (optional)
  hitl?: HITLController;
  rateLimiter?: RateLimiter;
  quota?: QuotaController;
  checkpoint?: CheckpointStorage;
  abortSignal?: AbortSignal;

  // Memory management (optional)
  compactionManager?: CompactionManager;
  workingMemory?: WorkingMemory;
  workingMemoryProcessor?: WorkingMemoryProcessor;
  qualityGate?: QualityGate;

  // Resilience (optional)
  errorClassifier?: ErrorClassifier;
  circuitBreaker?: CircuitBreaker;
  autoRepairer?: AutoRepairer;
  onError?: ErrorHandler;

  // Extensions (optional)
  mcpClients?: Map<string, MCPClient>;
  subagents?: SubagentRegistry;
  planner?: Planner;

  // Harness
  hookRegistry: HookRegistry;
  pluginManager?: PluginManager;
}
```

Update `createToolContext()` at line 507 — change `agentCtx.identity.sessionId` to `agentCtx.sessionId` and `agentCtx.controls.abortSignal` to `agentCtx.abortSignal`.

- [ ] **Step 2: Build and fix type errors**

```bash
npm run build 2>&1 | head -100
```

Expect ~200 type errors from all files still using `ctx.identity.X`, `ctx.core.X`, etc. This is expected and will guide us through the remaining steps.

- [ ] **Step 3: Fix ContextBuilder (L3) in src/core/context-builder.ts**

Replace the `build()` method (lines 105-159). The 8-object construction at lines 129-149 becomes flat:

```typescript
build(): AgentContext {
    if (!this.state.llm) {
      throw new Error('LLM adapter is required');
    }
    if (!this.state.tools) {
      throw new Error('ToolRegistry is required');
    }

    const services = this.appServices ?? createDefaultAppServices();
    const sessionId = this.state.sessionId ?? generateSessionId();
    const memory = this.state.memory ?? new InMemoryStore();
    const pauseController = this.state.pauseController ?? new DefaultPauseController();

    let tools: ToolRegistry;
    if (Array.isArray(this.state.tools)) {
      const registry = new SimpleToolRegistry();
      for (const tool of this.state.tools) {
        registry.register(tool);
      }
      tools = registry;
    } else {
      tools = this.state.tools;
    }

    const ctx: AgentContext = {
      sessionId,
      agentName: this.state.agentName ?? 'agent',
      llm: this.state.llm,
      tools,
      memory,
      pauseController,
      services,
      compactionManager: this.state.compactionManager ?? createTruncateCompactionManager(),
      hookRegistry: new HookRegistry(),
    };

    if (this.state.checkpoint) ctx.checkpoint = this.state.checkpoint;
    if (this.state.hitl) ctx.hitl = this.state.hitl;
    if (this.state.mcpClients !== undefined) ctx.mcpClients = this.state.mcpClients;
    if (this.state.subagents) ctx.subagents = this.state.subagents;
    if (this.state.abortSignal) ctx.abortSignal = this.state.abortSignal;
    if (this.state.onError) ctx.onError = this.state.onError;

    return ctx;
  }
```

- [ ] **Step 4: Fix AgentContextBuilder (L2 API) in src/api/context-builder.ts**

Replace the `build()` method (lines 274-370). Delete the 8-object construction + 36 lines of if-assignments. Replace with flat assignment:

```typescript
build(): AgentContext {
    if (!this.state.llm) {
      throw new Error('LLM adapter is required. Call with({ llm }) before build().');
    }

    let tools: ToolRegistry;
    if (Array.isArray(this.state.tools)) {
      const registry = new SimpleToolRegistry();
      for (const tool of this.state.tools) {
        registry.register(tool);
      }
      tools = registry;
    } else if (this.state.tools) {
      tools = this.state.tools;
    } else {
      throw new Error('Tools are required. Call with({ tools }) before build().');
    }

    const sessionId = this.state.sessionId ?? generateSessionId();
    const agentName = this.state.agentName ?? 'agent';
    const memory = this.state.memory ?? new InMemoryStore();
    const pauseController = this.state.pauseController ?? new DefaultPauseController();
    const appServices = this.state.appServices ?? createDefaultAppServices();

    if (this.state.tracer) {
      (appServices as { tracer?: Tracer }).tracer = this.state.tracer;
    }
    if (this.state.metrics) {
      (appServices as { metrics?: Metrics }).metrics = this.state.metrics;
    }

    const ctx: AgentContext = {
      sessionId,
      agentName,
      llm: this.state.llm,
      tools,
      memory,
      pauseController,
      services: appServices,
      compactionManager: this.state.compactionManager ?? createCompactionManager(),
      hookRegistry: this.state.hookRegistry ?? new HookRegistry(),
    };

    // Attach optional fields directly
    if (this.state.checkpoint !== undefined) ctx.checkpoint = this.state.checkpoint;
    if (this.state.hitl !== undefined) ctx.hitl = this.state.hitl;
    if (this.state.mcpClients !== undefined) ctx.mcpClients = this.state.mcpClients;
    if (this.state.subagents !== undefined) ctx.subagents = this.state.subagents;
    if (this.state.abortSignal !== undefined) ctx.abortSignal = this.state.abortSignal;
    if (this.state.onError !== undefined) ctx.onError = this.state.onError;
    if (this.state.securityGuard !== undefined) ctx.securityGuard = this.state.securityGuard;
    if (this.state.errorClassifier !== undefined) ctx.errorClassifier = this.state.errorClassifier;
    if (this.state.circuitBreaker !== undefined) ctx.circuitBreaker = this.state.circuitBreaker;
    if (this.state.autoRepairer !== undefined) ctx.autoRepairer = this.state.autoRepairer;
    if (this.state.planner !== undefined) ctx.planner = this.state.planner;
    if (this.state.rateLimiter !== undefined) ctx.rateLimiter = this.state.rateLimiter;
    if (this.state.inputSanitizer !== undefined) ctx.inputSanitizer = this.state.inputSanitizer;
    if (this.state.permissionController !== undefined) ctx.permissionController = this.state.permissionController;
    if (this.state.permissionPolicy !== undefined) ctx.permissionPolicy = this.state.permissionPolicy;
    if (this.state.sandboxExecutor !== undefined) ctx.sandboxExecutor = this.state.sandboxExecutor;
    if (this.state.auditLogger !== undefined) ctx.auditLogger = this.state.auditLogger;
    if (this.state.qualityGate !== undefined) ctx.qualityGate = this.state.qualityGate;
    if (this.state.quota !== undefined) ctx.quota = this.state.quota;
    if (this.state.logger !== undefined) ctx.logger = this.state.logger;
    if (this.state.hookRegistry !== undefined) ctx.hookRegistry = this.state.hookRegistry;
    if (this.state.healthChecker !== undefined) {
      ctx.services.healthChecker = this.state.healthChecker;
    }

    return ctx;
  }
```

- [ ] **Step 5: Delete normalizeServices() and FlatServiceOverrides from create-agent.ts**

In `src/api/create-agent.ts`:
1. Delete Lines 57-90: `FlatServiceOverrides` interface
2. Delete Lines 95-97: `AgentContextOverrides` type
3. Delete Lines 100-229: entire `normalizeServices()` function (128 lines)

- [ ] **Step 6: Rewrite createAgent() context construction in create-agent.ts**

Replace the AgentContext construction block (lines 264-282):

```typescript
  const ctx: AgentContext = {
    sessionId,
    agentName,
    llm,
    tools,
    memory: svc?.memory ?? memoryStub,
    pauseController: svc?.pauseController ?? pauseStub,
    services: appServices,
    hookRegistry,
    ...(svc?.logger ? { logger: svc.logger } : {}),
    // Spread remaining optional fields from overrides
    ...(svc?.permissionPolicy ? { permissionPolicy: svc.permissionPolicy } : {}),
    ...(svc?.permissionController ? { permissionController: svc.permissionController } : {}),
    ...(svc?.sandboxExecutor ? { sandboxExecutor: svc.sandboxExecutor } : {}),
    ...(svc?.auditLogger ? { auditLogger: svc.auditLogger } : {}),
    ...(svc?.inputSanitizer ? { inputSanitizer: svc.inputSanitizer } : {}),
    ...(svc?.securityGuard ? { securityGuard: svc.securityGuard } : {}),
    ...(svc?.hitl ? { hitl: svc.hitl } : {}),
    ...(svc?.rateLimiter ? { rateLimiter: svc.rateLimiter } : {}),
    ...(svc?.quota ? { quota: svc.quota } : {}),
    ...(svc?.checkpoint ? { checkpoint: svc.checkpoint } : {}),
    ...(svc?.abortSignal ? { abortSignal: svc.abortSignal } : {}),
    ...(svc?.compactionManager ? { compactionManager: svc.compactionManager } : {}),
    ...(svc?.qualityGate ? { qualityGate: svc.qualityGate } : {}),
    ...(svc?.errorClassifier ? { errorClassifier: svc.errorClassifier } : {}),
    ...(svc?.circuitBreaker ? { circuitBreaker: svc.circuitBreaker } : {}),
    ...(svc?.autoRepairer ? { autoRepairer: svc.autoRepairer } : {}),
    ...(svc?.onError ? { onError: svc.onError } : {}),
    ...(svc?.mcpClients ? { mcpClients: svc.mcpClients } : {}),
    ...(svc?.subagents ? { subagents: svc.subagents } : {}),
    ...(svc?.planner ? { planner: svc.planner } : {}),
    ...(svc?.pluginManager ? { pluginManager: svc.pluginManager } : {}),
  };
```

Replace `svc?.core?.llm` with the (now pre-resolved) `svc?.llm` at line 243. Replace `svc?.core?.services` with `svc?.services` at line 246. Replace `svc?.core?.tools` with `svc?.tools` at line 290-294. Replace `svc?.core?.logger` with `svc?.logger` at line 337.

Replace the validate block at lines 285-287:
```typescript
  if (ctx.permissionPolicy && !ctx.permissionController) {
    throw new AgentConfigError('permissionPolicy requires permissionController.');
  }
```

Replace `ctx.harness.pluginManager = pluginManager` at line 361 with `ctx.pluginManager = pluginManager`.

- [ ] **Step 7: Update function signature — flat overrides instead of sub-object**

Change `createAgent()` parameter type from `FlatServiceOverrides | AgentContextOverrides` to just `Partial<AgentContext>`:

```typescript
export function createAgent(
  config: AgentConfig,
  services?: Partial<AgentContext>
): AgentInterface {
```

Remove `normalizeServices()` call at line 236, assign directly:
```typescript
  const svc = services ?? {};
```

Replace `svc?.identity?.sessionId` with `svc?.sessionId` at line 237.
Replace `svc?.identity?.agentName` with `svc?.agentName` at line 238.

- [ ] **Step 8: Update all loop files — flatten ctx access**

Apply these mechanical renames across all files in `src/loop/`:

| Before | After |
|--------|-------|
| `ctx.identity.sessionId` | `ctx.sessionId` |
| `ctx.identity.agentName` | `ctx.agentName` |
| `ctx.core.llm` | `ctx.llm` |
| `ctx.core.tools` | `ctx.tools` |
| `ctx.core.memory` | `ctx.memory` |
| `ctx.core.pauseController` | `ctx.pauseController` |
| `ctx.core.services` | `ctx.services` |
| `ctx.core.logger` | `ctx.logger` |
| `ctx.security.permissionController` | `ctx.permissionController` |
| `ctx.security.permissionPolicy` | `ctx.permissionPolicy` |
| `ctx.security.sandboxExecutor` | `ctx.sandboxExecutor` |
| `ctx.security.auditLogger` | `ctx.auditLogger` |
| `ctx.security.inputSanitizer` | `ctx.inputSanitizer` |
| `ctx.security.securityGuard` | `ctx.securityGuard` |
| `ctx.controls.hitl` | `ctx.hitl` |
| `ctx.controls.rateLimiter` | `ctx.rateLimiter` |
| `ctx.controls.quota` | `ctx.quota` |
| `ctx.controls.checkpoint` | `ctx.checkpoint` |
| `ctx.controls.abortSignal` | `ctx.abortSignal` |
| `ctx.memory.compactionManager` | `ctx.compactionManager` |
| `ctx.memory.workingMemory` | `ctx.workingMemory` |
| `ctx.memory.workingMemoryProcessor` | `ctx.workingMemoryProcessor` |
| `ctx.memory.qualityGate` | `ctx.qualityGate` |
| `ctx.resilience.errorClassifier` | `ctx.errorClassifier` |
| `ctx.resilience.circuitBreaker` | `ctx.circuitBreaker` |
| `ctx.resilience.autoRepairer` | `ctx.autoRepairer` |
| `ctx.resilience.onError` | `ctx.onError` |
| `ctx.extensions.mcpClients` | `ctx.mcpClients` |
| `ctx.extensions.subagents` | `ctx.subagents` |
| `ctx.extensions.planner` | `ctx.planner` |
| `ctx.harness.hookRegistry` | `ctx.hookRegistry` |
| `ctx.harness.pluginManager` | `ctx.pluginManager` |

Files to update (use grep to find all occurrences):
- `src/loop/agent-loop.ts`
- `src/loop/llm-caller.ts`
- `src/loop/tool-executor.ts`
- `src/loop/plan-executor.ts`
- `src/loop/error-recovery-handler.ts`
- `src/loop/checkpoint-saver.ts`
- `src/loop/token-budget.ts`

- [ ] **Step 9: Update tests — flatten mock AgentContext**

Search for all `ctx.identity.`, `ctx.core.`, `ctx.security.`, `ctx.controls.`, `ctx.memory.`, `ctx.resilience.`, `ctx.extensions.`, `ctx.harness.` patterns in `tests/` and flatten using the same mapping table as Step 8.

- [ ] **Step 10: Verify build and tests pass**

```bash
npm run build
```

Expected: zero type errors.

```bash
npm run test
```

Expected: all 2478 tests pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: flatten AgentContext from 8 sub-objects to flat interface

Remove normalizeServices() (128 lines), delete 8 sub-interfaces, flatten
all ctx.X.Y accesses to ctx.Y across ~10 files. No functionality removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Unify HookName + LifecyclePhase (P1-4)

**Files:**
- Modify: `src/core/hooks.ts` — delete HookName object, extend LifecyclePhase
- Modify: `src/loop/agent-loop.ts` — update lifecycle emissions
- Modify: `src/loop/llm-caller.ts` — update lifecycle emissions
- Modify: `src/loop/tool-executor.ts` — update lifecycle emissions
- Modify: `src/loop/error-recovery-handler.ts` — update lifecycle emissions
- Modify: `src/plugins/pipeline.ts` — use new unified system
- Modify: `src/index.ts` — remove HookName export

- [ ] **Step 1: Delete HookName, extend LifecyclePhase in hooks.ts**

In `src/core/hooks.ts`, delete lines 68-109 (HookName object + type). Replace the LifecyclePhase type at line 266:

```typescript
/**
 * Lifecycle phase where hooks execute.
 *
 * - pre-llm / post-llm: blocking checkpoint hooks (quota, rate-limit, quality gate)
 * - All others: fire-and-forget observation hooks
 */
export type LifecyclePhase =
  | 'session.start' | 'session.end'
  | 'step.begin' | 'step.end'
  | 'pre-llm' | 'post-llm'
  | 'llm.request.before' | 'llm.response.after' | 'llm.error'
  | 'tool.before' | 'tool.after' | 'tool.error'
  | 'compaction.before' | 'compaction.after'
  | 'recovery.escalate' | 'recovery.compact' | 'recovery.fallback'
  | 'error';
```

Update `LifecycleHookEntry` (line 132) — change `name: HookName` to `phase: LifecyclePhase`:

```typescript
export interface LifecycleHookEntry {
  phase: LifecyclePhase;
  fn: HookFn;
  priority: number;
}
```

Update HookRegistry — change all `HookName` references to `LifecyclePhase`:

```typescript
export class HookRegistry {
  private lifecycle = new Map<LifecyclePhase, LifecycleHookEntry[]>();
  // ... rest unchanged except types

  on(phase: LifecyclePhase, fn: HookFn, priority = DEFAULT_REQUEST_HOOK_PRIORITY): () => void {
    const entry: LifecycleHookEntry = { phase, fn, priority };
    const existing = this.lifecycle.get(phase) ?? [];
    existing.push(entry);
    existing.sort((a, b) => a.priority - b.priority);
    this.lifecycle.set(phase, existing);
    return () => {
      const arr = this.lifecycle.get(phase);
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  registerLifecycle(hooks: Array<{ phase: LifecyclePhase; fn: HookFn; priority?: number }>): () => void {
    const unregisters = hooks.map(h => this.on(h.phase, h.fn, h.priority));
    return () => unregisters.forEach(u => u());
  }

  getLifecycleHooks(phase: LifecyclePhase): HookFn[] {
    return (this.lifecycle.get(phase) ?? []).map(e => e.fn);
  }
}
```

- [ ] **Step 2: Add DEFAULT_REQUEST_HOOK_PRIORITY constant**

In `src/core/hooks.ts`, add after the `RequestHookPriority` definition:

```typescript
/** Default priority for hooks registered without explicit priority */
export const DEFAULT_REQUEST_HOOK_PRIORITY = 100;
```

- [ ] **Step 3: Update src/index.ts — remove HookName export**

Change line 70 from:
```typescript
export { HookName, RequestHookPriority } from './core/hooks.js';
```
to:
```typescript
export { RequestHookPriority } from './core/hooks.js';
```

Export the new `LifecyclePhase` type (it's already exported at line 66-67).

- [ ] **Step 4: Update all lifecycle emission sites**

The string literals in hook emission calls remain the same. Only the type annotation on the HookRegistry methods changes. However, verify all call sites still type-check:

In `src/loop/agent-loop.ts`:
- `'session.start'`, `'session.end'`, `'step.begin'`, `'step.end'`
- `'pre-llm'`, `'post-llm'`
- `'llm.request.before'`, `'llm.response.after'`
- `'tool.before'`, `'tool.after'` (was `'tool.execute.before'`, `'tool.execute.after'`)
- `'compaction.before'`, `'compaction.after'`

In `src/loop/llm-caller.ts`:
- `'llm.error'`

In `src/loop/tool-executor.ts`:
- `'tool.before'`, `'tool.after'`, `'tool.error'` (was `'tool.execute.before'`, etc.)

In `src/loop/error-recovery-handler.ts`:
- `'recovery.escalate'`, `'recovery.compact'`, `'recovery.fallback'`

IMPORTANT: Since we shortened tool hook names (`tool.execute.before` → `tool.before`), update all corresponding string literals.

- [ ] **Step 5: Verify build and tests pass**

```bash
npm run build && npm run test
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: unify HookName and LifecyclePhase into single LifecyclePhase type

Delete 15-value HookName object (zero consumer references), extend
LifecyclePhase from 2 to 16 values covering all lifecycle cut-points.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Simplify RequestHookPriority 6 → 3 (P1-3)

**Files:**
- Modify: `src/core/hooks.ts` — replace 6-level with 3-level
- Modify: `src/plugins/memory-plugin.ts` — update priority reference
- Modify: `src/plugins/skills-plugin.ts` — update priority reference
- Modify: `src/loop/agent-loop.ts` — update priority reference
- Modify: `src/memory/index.ts` — remove RequestHookPriority re-export

- [ ] **Step 1: Replace RequestHookPriority in hooks.ts**

In `src/core/hooks.ts`, replace lines 43-64:

```typescript
export const RequestHookPriority = {
  /** Memory context — persistent memory and AGENTS.md (lowest = runs first) */
  MEMORY: 10,

  /** Working memory — pinned items and scratchpad (survives compaction) */
  WORKING_MEMORY: 20,

  /** Skill instructions — domain knowledge and tool descriptions */
  SKILL: 30,
} as const;
```

- [ ] **Step 2: Update plugin files**

In `src/plugins/memory-plugin.ts`:
- Change `RequestHookPriority.MEMORY_CONTEXT` → `RequestHookPriority.MEMORY`

In `src/plugins/skills-plugin.ts`:
- Change `RequestHookPriority.SKILL_INSTRUCTIONS` → `RequestHookPriority.SKILL`

In `src/loop/agent-loop.ts`:
- Change `RequestHookPriority.WORKING_MEMORY` → `RequestHookPriority.WORKING_MEMORY` (unchanged value name, just verify)

- [ ] **Step 3: Update src/memory/index.ts — remove re-export**

Search for and remove the line:
```typescript
export { RequestHookPriority } from '../core/hooks.js';
```

- [ ] **Step 4: Verify build and tests**

```bash
npm run build && npm run test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: simplify RequestHookPriority from 6 to 3 levels

Remove unused SYSTEM_RULES(10) and TOOL_DESCRIPTIONS(40), collapse
USER_CUSTOM(50) into DEFAULT_REQUEST_HOOK_PRIORITY constant.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Reduce Event Types 31 → ~13 (P1-2)

**Files:**
- Modify: `src/core/events.ts` — reduce event type enum + Zod schemas
- Modify: `src/loop/agent-loop.ts` — update event emissions
- Modify: `src/loop/llm-caller.ts` — replace `llm.chunk` with callback
- Modify: `src/index.ts` — remove deleted type guard exports
- Modify: `tests/` — update event type references

- [ ] **Step 1: Reduce AgentEventTypeSchema in events.ts**

Replace the `AgentEventTypeSchema` (lines 23-66):

```typescript
export const AgentEventTypeSchema = z.enum([
  'agent.start',
  'agent.complete',
  'agent.error',
  'llm.request',
  'llm.response',
  'tool.call',
  'tool.result',
  'state.change',
  'done',
  'subagent.start',
  'subagent.complete',
  'compaction.start',
  'compaction.complete',
  'permission',
]);
```

- [ ] **Step 2: Reduce AgentEventSchema in events.ts**

Replace the entire discriminated union (lines 159-485) with schemas for the 14 remaining events. Add optional `batchId` to `tool.call` and `tool.result`. Add optional `checkpoint` info to `state.change`. Merge `permission.prompt` + `permission.decision` into single `permission` event. Add `source?: 'subagent'` to `agent.error`.

```typescript
export const AgentEventSchema = z.discriminatedUnion('type', [
  // agent.start
  z.object({
    type: z.literal('agent.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    input: z.string(),
    agentName: z.string(),
    model: z.object({ provider: z.string(), model: z.string() }),
  }),

  // agent.complete (merged agent.step data)
  z.object({
    type: z.literal('agent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
    steps: z.number(),
    tokens: z.object({ input: z.number(), output: z.number() }).optional(),
  }),

  // agent.error (added source for subagent errors)
  z.object({
    type: z.literal('agent.error'),
    timestamp: z.number(),
    sessionId: z.string(),
    error: SerializedErrorSchema,
    step: z.number().optional(),
    source: z.enum(['agent', 'subagent']).optional(),
  }),

  // llm.request
  z.object({
    type: z.literal('llm.request'),
    timestamp: z.number(),
    sessionId: z.string(),
    messages: MessageSchema.array(),
    model: z.object({ provider: z.string(), model: z.string() }),
    tools: z.string().array().optional(),
  }),

  // llm.response (no llm.chunk — streaming uses callback)
  z.object({
    type: z.literal('llm.response'),
    timestamp: z.number(),
    sessionId: z.string(),
    content: z.string(),
    toolCalls: ToolCallSchema.array().optional(),
    finishReason: FinishReasonSchema,
    usage: z.object({ promptTokens: z.number(), completionTokens: z.number() }).optional(),
    reasoning: z.object({
      rawOutput: z.string().optional(),
      thoughtProcess: z.string().optional(),
      model: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }).optional(),
  }),

  // tool.call (added optional batchId)
  z.object({
    type: z.literal('tool.call'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
    batchId: z.string().optional(),
  }),

  // tool.result (added optional batchId, kept truncation/validation fields)
  z.object({
    type: z.literal('tool.result'),
    timestamp: z.number(),
    sessionId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.string(),
    isError: z.boolean().default(false),
    batchId: z.string().optional(),
    structuredOutput: z.unknown().optional(),
    isValid: z.boolean().optional(),
    validationError: z.string().optional(),
    truncated: z.boolean().optional(),
    originalLength: z.number().optional(),
  }),

  // state.change (added optional checkpoint info)
  z.object({
    type: z.literal('state.change'),
    timestamp: z.number(),
    sessionId: z.string(),
    from: z.string(),
    to: z.string(),
    checkpoint: z.object({
      id: z.string(),
      position: z.enum(['before_llm', 'after_llm', 'before_tool', 'after_tool']),
    }).optional(),
  }),

  // done
  z.object({
    type: z.literal('done'),
    timestamp: z.number(),
    sessionId: z.string(),
    reason: FinishReasonSchema,
  }),

  // subagent.start
  z.object({
    type: z.literal('subagent.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    parentSessionId: z.string(),
    subagentName: z.string(),
    input: z.string(),
  }),

  // subagent.complete
  z.object({
    type: z.literal('subagent.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    output: z.string(),
  }),

  // compaction.start
  z.object({
    type: z.literal('compaction.start'),
    timestamp: z.number(),
    sessionId: z.string(),
    strategy: z.enum(['truncate-oldest', 'summarize', 'importance-weighted', 'snip', 'pointer-indexed', 'microcompact']),
    tokensBefore: z.number(),
  }),

  // compaction.complete
  z.object({
    type: z.literal('compaction.complete'),
    timestamp: z.number(),
    sessionId: z.string(),
    tokensAfter: z.number(),
    removedMessages: z.number(),
    summarizedMessages: z.number().optional(),
  }),

  // permission (merged prompt + decision)
  z.object({
    type: z.literal('permission'),
    timestamp: z.number(),
    sessionId: z.string(),
    promptId: z.string(),
    permission: z.string(),
    decision: z.enum(['allow', 'deny', 'allow_always']).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
]);
```

- [ ] **Step 3: Remove deleted type guards from events.ts**

Delete these type guard functions:
- `isSubagentEvent` (lines 525-529) — keep the two subagent events but type guard less critical
- `isMCPEvent` (lines 532-536) — no MCP events remain
- `isWorkflowEvent` (lines 539-543) — no workflow events remain
- `isPermissionEvent` (lines 553-557) — merged into single event, use `event.type === 'permission'` directly

Keep: `isAgentEvent`, `isLLMEvent`, `isToolEvent`, `isAgentLifecycleEvent`, `isTerminalEvent`, `isCompactionEvent`.

- [ ] **Step 4: Add onChunk callback to LLM call options**

In `src/core/interfaces.ts` (or wherever LLMAdapter is defined), find the `chat()` method. Add an optional `onChunk` callback to the options parameter (not the LLMAdapter interface itself — pass it in the call options):

```typescript
// In the LLM call options (likely in llm-caller.ts or interfaces.ts)
interface LLMCallOptions {
  // ... existing options
  /** Streaming chunk callback — bypasses Zod event validation for performance */
  onChunk?: (chunk: { content: string; toolCallId?: string; toolName?: string; argsDelta?: string }) => void;
}
```

- [ ] **Step 5: Update agent-loop.ts — replace llm.chunk emission with callback**

In `src/loop/agent-loop.ts`, find where `llm.chunk` events are emitted. Replace with `onChunk` callback passed through LLM call options.

Search for: `emitter.emit({ type: 'llm.chunk'` 
Replace with: pass the data through `onChunk` callback in the streaming call.

- [ ] **Step 6: Update agent-loop.ts — remove deleted event emissions**

Remove emissions of:
- `agent.step` — merge step count into `agent.complete.steps`
- `tool.batch.start` / `tool.batch.complete` — add `batchId` to individual `tool.call` / `tool.result`
- `checkpoint` — merge into `state.change.checkpoint`
- `file.change` — remove entirely
- `permission.prompt` / `permission.decision` — emit single `permission` event with both fields

- [ ] **Step 7: Update src/index.ts — remove deleted type guard exports**

Remove from the exports block (lines 99-107):
- `isSubagentEvent` (if was exported)
- `isMCPEvent` (if was exported)
- `isWorkflowEvent` (if was exported)
- `isPermissionEvent` (if was exported)

- [ ] **Step 8: Verify build and tests**

```bash
npm run build && npm run test
```

Expected: type errors at event emission sites that still use deleted types. Fix each one.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: reduce event types from 31 to 14, remove Zod from streaming path

Replace llm.chunk event (Zod-validated, dozens/sec in streaming) with
lightweight onChunk callback. Remove 13+ unused event types (mcp.*,
workflow.*, etc). Merge related events (batch into tool, checkpoint
into state.change, permission.prompt+decision into single permission).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Clean Sub-Path Exports (P1-5)

**Files:**
- Modify: `package.json` — remove 5 sub-path entries
- Modify: `src/core/index.ts` — filter internal symbol exports
- Modify: `src/api/index.ts` — filter internal re-exports
- Modify: `src/plugins/index.ts` — remove cross-module re-exports
- Modify: `src/memory/index.ts` — remove cross-module re-exports
- Modify: `src/resilience/index.ts` — remove cross-module re-exports
- Create: `src/lifecycle/index.ts` → add re-exports to `src/core/index.ts` before deleting

- [ ] **Step 1: Merge thin sub-paths into core**

First, check what each thin sub-path exports and re-export from `src/core/index.ts`:

For `src/lifecycle/index.ts` — likely exports `GracefulShutdown` class. Add to `src/core/index.ts`:
```typescript
export { GracefulShutdown } from '../lifecycle/index.js';
export type { ShutdownResult } from '../lifecycle/index.js';
```

For `src/observability/index.ts` — check exports. Add relevant public types:
```typescript
export type { HealthChecker, MetricsCollector } from '../observability/index.js';
```

For `src/quota/index.ts` — re-export `QuotaController` type:
```typescript
export type { QuotaController } from '../quota/quota-controller.js';
```

For `src/validation/index.ts` — re-export quality gate types:
```typescript
export type { QualityGate } from '../validation/quality-gate.js';
```

For `src/audit/index.ts` — re-export audit types:
```typescript
export type { AuditStore, AuditLogger } from '../audit/index.js';
```

- [ ] **Step 2: Remove merged sub-paths from package.json**

Delete these entries from the `exports` map in `package.json`:
- `./lifecycle` (lines 53-56)
- `./validation` (lines 57-60)
- `./observability` (lines 49-52)
- `./quota` (lines 45-48)
- `./audit` (lines 37-40)
- `./quickstart` (lines 121-124)

- [ ] **Step 3: Clean src/core/index.ts — remove internal exports**

Remove the following from `src/core/index.ts`:
- All Zod schema value exports (keep type-only exports via `export type`)
- `AgentEventEmitter` class export
- `ContextBuilder` class export (it's exported from main index anyway)
- `SimpleToolRegistry` class export
- `DelegatingToolRegistry` class export
- `HookRegistry` class export
- `DefaultPauseController` class export
- `DefaultHITLController` class export
- `InMemoryStore` class export
- `SimpleSchemaRegistry` class export
- `DefaultLogger`, `NoopLogger` class exports
- `NoopTracer`, `ConsoleTracer`, `NoopMetrics`, `ConsoleMetrics`, `BridgeMetrics` class exports
- `AgentStateMachine` class export
- `DefaultApprovalChannel` class export
- `DefaultPromptBuilder` class export
- `zodToJsonSchema`, `zodToFunctionDef`, `toolToFunctionDef`, `toolsToFunctionDefs` util exports

Keep only: interfaces (as types), type guards, `createDefaultAppServices`, `generateSessionId`, `createToolContext`.

- [ ] **Step 4: Clean src/api/index.ts — remove internal re-exports**

Remove re-exports of:
- `ContextBuilder`
- `SimpleToolRegistry`
- `InMemoryStore`
- `DefaultPauseController`
- `DefaultHITLController`
- `generateSessionId`

These are from the block at the bottom of `src/api/context-builder.ts` (lines 403-410). Delete that re-export block entirely.

- [ ] **Step 5: Clean src/plugins/index.ts — remove cross-module re-exports**

Search for and remove any re-exports from other modules. Specifically check for:
- `TodoItem`, `TodoListState`, `TodoStatus`, `TodoPriority`, `formatTodoState` from `../tools/todo-list.js`

- [ ] **Step 6: Clean src/memory/index.ts — remove cross-module re-exports**

Remove the line:
```typescript
export { RequestHookPriority } from '../core/hooks.js';
```

- [ ] **Step 7: Clean src/resilience/index.ts — remove cross-module re-exports**

Remove re-exports of types from `../contracts/mpu-interfaces.js`:
- `ErrorSeverity`, `ErrorClassifier`, `CircuitBreakerState`, `CircuitBreakerConfig`, `CircuitBreaker`, `AutoRepairer`, `RepairResult`, `RepairHandler`

- [ ] **Step 8: Add @internal JSDoc annotations**

Add `/** @internal */` to all symbols in core/index.ts, api/index.ts, and other sub-path index files that should not be part of the public API but must remain exported for internal module use.

- [ ] **Step 9: Verify build, tests, and lint**

```bash
npm run build
```

Expected: zero type errors. If consumer code imported from removed sub-paths, fix those imports to use new locations.

```bash
npm run test
```

Expected: all tests pass.

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: clean sub-path exports — merge 5 thin modules, remove internal leaks

Merge lifecycle/validation/observability/quota/audit into core sub-path.
Remove Zod schema value exports, internal classes, and cross-module
re-exports from sub-path index files. Add @internal annotations.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all 5 tasks complete:

- [ ] `npm run build` — zero type errors
- [ ] `npm run test` — all tests pass
- [ ] `npm run lint` — no lint errors
- [ ] Verify `src/index.ts` still exports ~69 curated symbols (count them)
- [ ] Verify `package.json` exports map has ~22 entries (down from 27)
- [ ] Verify sub-path imports still work: `import { ... } from 'agentforge/core'`
