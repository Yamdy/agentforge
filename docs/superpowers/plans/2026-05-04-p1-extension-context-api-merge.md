# P1-9/10/11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Converge 5 extension mechanisms into 1 (Plugin), group AgentContext into 8 sub-objects, and curate public API from 500+ to ~60 exports.

**Architecture:** Three-phase sequential refactoring. P1-9 introduces `CheckpointHook` on Plugin, deletes `CheckpointRegistry`, internalizes `HookRegistry`+`EventEmitter`. P1-10 restructures `AgentContext` into identity/core/security/controls/memory/resilience/extensions/harness sub-objects. P1-11 prunes `src/index.ts` to core exports only.

**Tech Stack:** TypeScript strict mode, Zod, Vitest

**Spec:** docs/superpowers/specs/2026-05-04-p1-extension-context-api-merge.md

---

## File Map

| Phase | Create | Modify | Delete |
|-------|--------|--------|--------|
| P1-9 | `src/plugins/builtin-checkpoints.ts`, `tests/plugins/builtin-checkpoints.spec.ts`, `tests/plugins/checkpoint-hooks.spec.ts` | `src/plugins/plugin.ts`, `src/plugins/pipeline.ts`, `src/plugins/manager.ts`, `src/plugins/index.ts`, `src/core/hooks.ts`, `src/core/index.ts`, `src/loop/agent-loop.ts`, `src/api/create-agent.ts`, `src/api/context-builder.ts`, `src/index.ts`, `tests/loop/agent-loop.spec.ts`, `tests/plugins/*.spec.ts`, `tests/core/hooks.spec.ts`, `tests/api/create-agent.spec.ts` | `src/core/checkpoint-registry.ts`, `tests/core/checkpoint-registry.spec.ts` |
| P1-10 | (none) | `src/core/context.ts`, `src/core/context-builder.ts`, `src/core/index.ts`, `src/api/context-builder.ts`, `src/api/create-agent.ts`, `src/loop/agent-loop.ts`, `src/loop/tool-executor.ts`, `src/loop/llm-caller.ts`, `src/loop/error-recovery-handler.ts`, `src/resilience/auto-repairer.ts`, `src/index.ts`, `tests/loop/agent-loop.spec.ts`, `tests/core/defaults.spec.ts`, `tests/api/create-agent.spec.ts`, `tests/plugins/memory-plugin.spec.ts`, `tests/plugins/plugin-loader.spec.ts`, `tests/audit/*.spec.ts`, `tests/security/*.spec.ts`, `tests/integration/*.spec.ts` | (none) |
| P1-11 | (none) | `src/index.ts`, `tests/api/*.spec.ts` (import path updates) | (none) |

---

### Task 1: Define CheckpointHook type and extend Plugin interface

**Files:**
- Modify: `src/core/hooks.ts`
- Modify: `src/plugins/plugin.ts`

- [ ] **Step 1: Add CheckpointHook type to hooks.ts**

```typescript
// In src/core/hooks.ts, add after ToolProviderHook section:

import type { AgentContext } from './context.js';
import type { AgentState } from './state.js';

export type LifecyclePhase = 'pre-llm' | 'post-llm';

export type CheckpointResult = 
  | { action: 'continue' } 
  | { action: 'block'; reason: string };

export type CheckpointFn = (
  ctx: AgentContext,
  state: AgentState,
  ...args: unknown[]
) => CheckpointResult | Promise<CheckpointResult>;

export interface CheckpointHook {
  name: string;
  phase: LifecyclePhase;
  priority: number;
  check: CheckpointFn;
}
```

- [ ] **Step 2: Add checkpointHooks to Plugin interface**

```typescript
// In src/plugins/plugin.ts, add to Plugin interface:
import type { CheckpointHook } from '../core/hooks.js';

// Inside Plugin interface, add:
  /** Checkpoint hooks — register cross-cutting lifecycle checks */
  checkpointHooks?: CheckpointHook[];
```

- [ ] **Step 3: Run build to verify types**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/core/hooks.ts src/plugins/plugin.ts
git commit -m "feat: add CheckpointHook type and extend Plugin with checkpointHooks"
```

---

### Task 2: Update Pipeline to support checkpoint hooks

**Files:**
- Modify: `src/plugins/pipeline.ts`

- [ ] **Step 1: Extend applyPlugins to register checkpoint hooks**

The signature changes: `applyPlugins` now returns an object with `unregister` + `checkpointRunners` (a `Map<LifecyclePhase, CheckpointFn[]>` for the agent loop to call).

```typescript
// src/plugins/pipeline.ts — new version
import type { Plugin, PluginContext } from './plugin.js';
import type { CheckpointHook, LifecyclePhase, CheckpointFn } from '../core/hooks.js';
import { HookRegistry } from '../core/hooks.js';
import { AgentEventEmitter } from '../core/events.js';

export interface AppliedPipeline {
  unregister(): void;
  getCheckpoints(phase: LifecyclePhase): CheckpointFn[];
}

export function applyPlugins(
  plugins: readonly Plugin[],
  hookRegistry: HookRegistry,
  emitter: AgentEventEmitter,
  _ctx: PluginContext
): AppliedPipeline {
  const unregisters: Array<() => void> = [];
  const checkpoints = new Map<LifecyclePhase, Array<{ priority: number; fn: CheckpointFn }>>();

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    if (plugin.requestHooks) {
      for (const hook of plugin.requestHooks) {
        unregisters.push(hookRegistry.registerRequest(hook));
      }
    }

    if (plugin.toolHooks) {
      for (const hook of plugin.toolHooks) {
        unregisters.push(hookRegistry.registerTool(hook));
      }
    }

    if (plugin.toolProviderHooks) {
      for (const hook of plugin.toolProviderHooks) {
        unregisters.push(hookRegistry.registerToolProvider(hook));
      }
    }

    if (plugin.lifecycleHooks) {
      for (const h of plugin.lifecycleHooks) {
        unregisters.push(hookRegistry.on(h.name, h.fn, h.priority));
      }
    }

    // ── New: checkpoint hooks ──
    if (plugin.checkpointHooks) {
      for (const ch of plugin.checkpointHooks) {
        let entries = checkpoints.get(ch.phase);
        if (!entries) {
          entries = [];
          checkpoints.set(ch.phase, entries);
        }
        entries.push({ priority: ch.priority, fn: ch.check });
        entries.sort((a, b) => a.priority - b.priority);
      }
    }

    if (plugin.eventSubscriptions) {
      for (const sub of plugin.eventSubscriptions) {
        unregisters.push(
          emitter.on(sub.event, event => {
            void Promise.resolve()
              .then(() => sub.handler(event))
              .catch(() => { /* isolate */ });
          })
        );
      }
    }
  }

  return {
    unregister: () => {
      for (const unreg of unregisters) {
        try { unreg(); } catch { /* isolate */ }
      }
    },
    getCheckpoints: (phase: LifecyclePhase): CheckpointFn[] => {
      return (checkpoints.get(phase) ?? []).map(e => e.fn);
    },
  };
}
```

- [ ] **Step 2: Update plugins/index.ts exports**

```typescript
// Add to src/plugins/index.ts:
export { applyPlugins, type AppliedPipeline } from './pipeline.js';
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/pipeline.ts src/plugins/index.ts
git commit -m "feat: extend applyPlugins to return checkpoint runners"
```

---

### Task 3: Create built-in checkpoint plugins

**Files:**
- Create: `src/plugins/builtin-checkpoints.ts`

- [ ] **Step 1: Write failing test**

Create `tests/plugins/builtin-checkpoints.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createQuotaPlugin, createRateLimitPlugin, createQualityGatePlugin, createCircuitBreakerPlugin } from '../../src/plugins/builtin-checkpoints.js';

describe('Built-in Checkpoint Plugins', () => {
  it('createQuotaPlugin should have pre-llm checkpoint hook', () => {
    const plugin = createQuotaPlugin();
    expect(plugin.name).toBe('builtin:quota');
    expect(plugin.checkpointHooks).toHaveLength(1);
    expect(plugin.checkpointHooks![0]!.phase).toBe('pre-llm');
    expect(plugin.checkpointHooks![0]!.priority).toBe(10);
  });

  it('createRateLimitPlugin should have pre-llm checkpoint hook', () => {
    const plugin = createRateLimitPlugin();
    expect(plugin.name).toBe('builtin:rate-limit');
    expect(plugin.checkpointHooks).toHaveLength(1);
    expect(plugin.checkpointHooks![0]!.phase).toBe('pre-llm');
  });

  it('createQualityGatePlugin should have post-llm checkpoint hook', () => {
    const plugin = createQualityGatePlugin();
    expect(plugin.name).toBe('builtin:quality-gate');
    expect(plugin.checkpointHooks![0]!.phase).toBe('post-llm');
  });

  it('createCircuitBreakerPlugin should have post-llm checkpoint hook', () => {
    const plugin = createCircuitBreakerPlugin();
    expect(plugin.name).toBe('builtin:circuit-breaker');
    expect(plugin.checkpointHooks![0]!.phase).toBe('post-llm');
  });

  it('quota plugin returns block when ctx.quota is exceeded', async () => {
    const plugin = createQuotaPlugin();
    const hook = plugin.checkpointHooks![0]!;
    const ctx = { controls: { quota: { check: async () => ({ allowed: false, reason: 'quota exceeded' }) } } } as any;
    const result = await hook.check(ctx, {} as any);
    expect(result).toEqual({ action: 'block', reason: 'quota exceeded' });
  });

  it('rate-limit plugin returns block when ctx.rateLimiter throttles', async () => {
    const plugin = createRateLimitPlugin();
    const hook = plugin.checkpointHooks![0]!;
    const ctx = { controls: { rateLimiter: { check: async () => ({ allowed: false, reason: 'rate limited' }) } } } as any;
    const result = await hook.check(ctx, {} as any);
    expect(result).toEqual({ action: 'block', reason: 'rate limited' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest tests/plugins/builtin-checkpoints.spec.ts
```

- [ ] **Step 3: Implement builtin-checkpoints.ts**

```typescript
// src/plugins/builtin-checkpoints.ts
import type { Plugin } from './plugin.js';
import type { CheckpointHook } from '../core/hooks.js';
import type { AgentContext } from '../core/context.js';
import type { AgentState } from '../core/state.js';

export function createQuotaPlugin(): Plugin {
  const check: CheckpointHook['check'] = async (ctx: AgentContext) => {
    if (ctx.controls?.quota) {
      const result = await ctx.controls.quota.check();
      if (!result.allowed) {
        return { action: 'block', reason: result.reason ?? 'quota exceeded' };
      }
    }
    return { action: 'continue' };
  };

  return {
    name: 'builtin:quota',
    enabled: true,
    checkpointHooks: [{ name: 'quota-check', phase: 'pre-llm', priority: 10, check }],
  };
}

export function createRateLimitPlugin(): Plugin {
  const check: CheckpointHook['check'] = async (ctx: AgentContext) => {
    if (ctx.controls?.rateLimiter) {
      const result = await ctx.controls.rateLimiter.check();
      if (!result.allowed) {
        return { action: 'block', reason: result.reason ?? 'rate limit exceeded' };
      }
    }
    return { action: 'continue' };
  };

  return {
    name: 'builtin:rate-limit',
    enabled: true,
    checkpointHooks: [{ name: 'rate-limit-check', phase: 'pre-llm', priority: 20, check }],
  };
}

export function createQualityGatePlugin(): Plugin {
  const check: CheckpointHook['check'] = async (ctx: AgentContext, _state: AgentState, ...args: unknown[]) => {
    if (ctx.memory?.qualityGate) {
      const llmResponse = args[0];
      const result = await ctx.memory.qualityGate.validate(llmResponse);
      if (!result.passed) {
        return { action: 'block', reason: result.reason ?? 'quality gate failed' };
      }
    }
    return { action: 'continue' };
  };

  return {
    name: 'builtin:quality-gate',
    enabled: true,
    checkpointHooks: [{ name: 'quality-gate-check', phase: 'post-llm', priority: 10, check }],
  };
}

export function createCircuitBreakerPlugin(): Plugin {
  const check: CheckpointHook['check'] = async (ctx: AgentContext) => {
    if (ctx.resilience?.circuitBreaker) {
      const tripped = await ctx.resilience.circuitBreaker.isTripped();
      if (tripped) {
        return { action: 'block', reason: 'circuit breaker tripped' };
      }
    }
    return { action: 'continue' };
  };

  return {
    name: 'builtin:circuit-breaker',
    enabled: true,
    checkpointHooks: [{ name: 'circuit-breaker-check', phase: 'post-llm', priority: 20, check }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest tests/plugins/builtin-checkpoints.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/plugins/builtin-checkpoints.ts tests/plugins/builtin-checkpoints.spec.ts
git commit -m "feat: add built-in checkpoint plugins (quota/rate-limit/quality-gate/circuit-breaker)"
```

---

### Task 4: Rewrite agent-loop to use pipeline checkpoints instead of CheckpointRegistry

**Files:**
- Modify: `src/loop/agent-loop.ts`

The agent-loop currently creates a CheckpointRegistry inline and registers 4 checkpoints. Replace with pipeline-based checkpoints from applyPlugins. The `AppliedPipeline.getCheckpoints(phase)` returns functions to call at each checkpoint.

- [ ] **Step 1: Read agent-loop.ts to understand checkpoint usage (lines ~125-180, ~1100, ~1230)**

Checkpoints are used in 3 places:
1. Lines ~125-180: register 4 checkpoints into checkpointRegistry
2. Line ~1100: `checkpointRegistry.run('pre-llm', ctx, state, msgs)`
3. Line ~1230: `checkpointRegistry.run('post-llm', ctx, state, response)`

- [ ] **Step 2: Refactor agent-loop checkpoint sections**

Remove the 4 hardcoded `checkpointRegistry.register()` calls. The pipeline (built by create-agent) now provides checkpoint runners via a new parameter.

The agent-loop will accept `preLlmCheckpoints: CheckpointFn[]` and `postLlmCheckpoints: CheckpointFn[]` arrays instead of a CheckpointRegistry.

```typescript
// In agent-loop.ts, replace:
//   const checkpointRegistry = ctx.checkpointRegistry ?? new CheckpointRegistry();
//   checkpointRegistry.register('pre-llm', 10, async ...);
//   ...etc
//
// With simply:
//   const preLlmCheckpoints = pipeline.getCheckpoints('pre-llm');
//   const postLlmCheckpoints = pipeline.getCheckpoints('post-llm');

// At the pre-llm checkpoint (line ~1100):
// Replace: const preLlmResult = await checkpointRegistry.run('pre-llm', ctx, state, msgs);
// With:
let blocked = false;
let blockReason = '';
for (const fn of preLlmCheckpoints) {
  const result = await fn(ctx, state, msgs);
  if (result.action === 'block') {
    blocked = true;
    blockReason = result.reason;
    break;
  }
}
if (blocked) {
  emitter.emit({ ...serializeError(new Error(blockReason)), type: 'agent.error' });
  emitter.emit({ type: 'done', reason: 'blocked' });
  return '';
}

// Same pattern for post-llm checkpoint (line ~1230)
```

- [ ] **Step 3: Update agent-loop function signature**

The loop now accepts `preLlmCheckpoints` and `postLlmCheckpoints` in its config instead of relying on `ctx.checkpointRegistry`.

```typescript
// In createAgentLoop config:
export interface AgentLoopConfig {
  // existing fields...
  preLlmCheckpoints?: CheckpointFn[];
  postLlmCheckpoints?: CheckpointFn[];
}
```

- [ ] **Step 4: Commit**

---

### Task 5: Update create-agent.ts to wire pipeline checkpoints

**Files:**
- Modify: `src/api/create-agent.ts`

- [ ] **Step 1: Build pipeline earlier, pass checkpoints to agent-loop**

```typescript
// In create-agent.ts, after buildPipeline:
const pipeline = applyPlugins(allPlugins, hookRegistry, emitterBridge(loop), pluginCtx);

// Extract checkpoints
const preLlmCheckpoints = pipeline.getCheckpoints('pre-llm');
const postLlmCheckpoints = pipeline.getCheckpoints('post-llm');

// Pass to agent-loop config
const loop = createAgentLoop(ctx, {
  ...loopConfig,
  preLlmCheckpoints,
  postLlmCheckpoints,
});
```

- [ ] **Step 2: Commit**

---

### Task 6: Internalize HookRegistry, CheckpointRegistry, AgentEventEmitter from public API

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Remove HookRegistry from public exports**

In `src/index.ts`, remove the export block:
```typescript
export { HookName, type HookFn, type LifecycleHookEntry,
  type RequestHook, type ToolHook, HookRegistry } from './core/hooks.js';
```

Also remove `AgentEventEmitter` export.

Also remove `CheckpointRegistry` export if present.

- [ ] **Step 2: Keep HookName, RequestHook, ToolHook types (still needed by Plugin)**

Replace with:
```typescript
export {
  HookName,
  RequestHookPriority,
  type HookFn,
  type LifecycleHookEntry,
  type RequestHook,
  type ToolHook,
  type ToolProviderHook,
  type CheckpointHook,
  type CheckpointFn,
  type CheckpointResult,
  type LifecyclePhase,
} from './core/hooks.js';
```

- [ ] **Step 3: Commit**

---

### Task 7: Update all tests for P1-9 changes

**Files:**
- Modify: `tests/loop/agent-loop.spec.ts`
- Modify: `tests/plugins/plugins.test.ts`
- Modify: `tests/plugins/plugin-loader.spec.ts`
- Modify: `tests/plugins/plugin-state.spec.ts`
- Modify: `tests/plugins/memory-plugin.spec.ts`
- Modify: `tests/core/hooks.spec.ts`
- Modify: `tests/api/create-agent.spec.ts`

- [ ] **Step 1: Run all tests to see which fail**

```bash
npx vitest run 2>&1 | tail -30
```

- [ ] **Step 2: Update each failing test file to use new Plugin-based API**

Tests that create HookRegistry directly → use Plugin with hooks instead.
Tests that reference CheckpointRegistry → use checkpointHooks on Plugin.
Tests that reference AgentEventEmitter → use Plugin eventSubscriptions.

- [ ] **Step 3: Ensure all 2452+ tests pass**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

---

### Task 8: P1-10 — Refactor AgentContext into 8 sub-objects

**Files:**
- Modify: `src/core/context.ts` (definition)
- Modify: `src/core/context-builder.ts`
- Modify: `src/api/context-builder.ts`
- Modify: `src/api/create-agent.ts`
- Modify: `src/loop/agent-loop.ts`
- Modify: `src/loop/tool-executor.ts`
- Modify: `src/loop/llm-caller.ts`
- Modify: `src/loop/error-recovery-handler.ts`
- Modify: `src/core/checkpoint-registry.ts` (before deletion)
- Modify: `src/resilience/auto-repairer.ts`
- Modify: All test files referencing AgentContext

- [ ] **Step 1: Define new grouped AgentContext interface**

```typescript
// src/core/context.ts — new AgentContext
export interface AgentIdentity { sessionId: string; agentName: string; }

export interface AgentCore {
  llm: LLMAdapter;
  tools: ToolRegistry;
  memory: MemoryStore;
  pauseController: PauseController;
  services: ApplicationServices;
  logger?: Logger;
}

export interface AgentSecurity {
  permissionPolicy?: PermissionPolicy;
  permissionController?: PermissionController;
  sandboxExecutor?: SandboxExecutor;
  auditLogger?: AuditLogger;
  inputSanitizer?: InputSanitizer;
  securityGuard?: SecurityGuard;
}

export interface AgentControls {
  hitl?: HITLController;
  rateLimiter?: RateLimiter;
  quota?: QuotaController;
  checkpoint?: CheckpointStorage;
  abortSignal?: AbortSignal;
}

export interface AgentMemoryContext {
  compactionManager?: CompactionManager;
  workingMemory?: WorkingMemory;
  workingMemoryProcessor?: WorkingMemoryProcessor;
  qualityGate?: QualityGate;
}

export interface AgentResilience {
  errorClassifier?: ErrorClassifier;
  circuitBreaker?: CircuitBreaker;
  autoRepairer?: AutoRepairer;
  onError?: ErrorHandler;
}

export interface AgentExtensions {
  mcpClients?: Map<string, MCPClient>;
  subagents?: SubagentRegistry;
  planner?: Planner;
}

export interface AgentHarness {
  hookRegistry: HookRegistry;
}

export interface AgentContext {
  identity: AgentIdentity;
  core: AgentCore;
  security: AgentSecurity;
  controls: AgentControls;
  memory: AgentMemoryContext;
  resilience: AgentResilience;
  extensions: AgentExtensions;
  harness: AgentHarness;
}
```

- [ ] **Step 2: Update all src/ files with find-and-replace pattern**

Access changes (systematic for all src/ files):
| Old | New |
|-----|-----|
| `ctx.sessionId` | `ctx.identity.sessionId` |
| `ctx.agentName` | `ctx.identity.agentName` |
| `ctx.llm` | `ctx.core.llm` |
| `ctx.tools` | `ctx.core.tools` |
| `ctx.memory` | `ctx.core.memory` |
| `ctx.pauseController` | `ctx.core.pauseController` |
| `ctx.services` | `ctx.core.services` |
| `ctx.logger` | `ctx.core.logger` |
| `ctx.permissionPolicy` | `ctx.security.permissionPolicy` |
| `ctx.permissionController` | `ctx.security.permissionController` |
| `ctx.sandboxExecutor` | `ctx.security.sandboxExecutor` |
| `ctx.auditLogger` | `ctx.security.auditLogger` |
| `ctx.inputSanitizer` | `ctx.security.inputSanitizer` |
| `ctx.securityGuard` | `ctx.security.securityGuard` |
| `ctx.hitl` | `ctx.controls.hitl` |
| `ctx.rateLimiter` | `ctx.controls.rateLimiter` |
| `ctx.quota` | `ctx.controls.quota` |
| `ctx.checkpoint` | `ctx.controls.checkpoint` |
| `ctx.abortSignal` | `ctx.controls.abortSignal` |
| `ctx.compactionManager` | `ctx.memory.compactionManager` |
| `ctx.workingMemory` | `ctx.memory.workingMemory` |
| `ctx.workingMemoryProcessor` | `ctx.memory.workingMemoryProcessor` |
| `ctx.qualityGate` | `ctx.memory.qualityGate` |
| `ctx.errorClassifier` | `ctx.resilience.errorClassifier` |
| `ctx.circuitBreaker` | `ctx.resilience.circuitBreaker` |
| `ctx.autoRepairer` | `ctx.resilience.autoRepairer` |
| `ctx.onError` | `ctx.resilience.onError` |
| `ctx.mcpClients` | `ctx.extensions.mcpClients` |
| `ctx.subagents` | `ctx.extensions.subagents` |
| `ctx.planner` | `ctx.extensions.planner` |
| `ctx.hookRegistry` | `ctx.harness.hookRegistry` |
| `ctx.checkpointRegistry` | (removed — replaced by pipeline) |

- [ ] **Step 3: Update ContextBuilder to build grouped objects**

```typescript
// In context-builder.ts, build() returns grouped AgentContext:
build(): AgentContext {
  return {
    identity: { sessionId, agentName },
    core: { llm, tools, memory, pauseController, services, logger },
    security: { permissionPolicy, permissionController, sandboxExecutor,
                auditLogger, inputSanitizer, securityGuard },
    controls: { hitl, rateLimiter, quota, checkpoint, abortSignal },
    memory: { compactionManager, workingMemory, workingMemoryProcessor, qualityGate },
    resilience: { errorClassifier, circuitBreaker, autoRepairer, onError },
    extensions: { mcpClients, subagents, planner },
    harness: { hookRegistry },
  };
}
```

- [ ] **Step 4: Run tests to identify all breakage**

```bash
npx vitest run 2>&1 | grep "FAIL\|Error\|Property.*does not exist"
```

- [ ] **Step 5: Fix all test files**

Each test file that constructs AgentContext needs to use the grouped format.

- [ ] **Step 6: All tests pass**

- [ ] **Step 7: Commit**

---

### Task 9: P1-11 — Curate public API to ~60 core exports

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite src/index.ts with curated exports**

Remove all internal implementation exports. Keep only the ~60 core symbols as designed.

- [ ] **Step 2: Verify exports with build**

```bash
npm run build
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 4: Commit**

---

### Task 10: Final validation — full test suite + adversarial review

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Must be 0 failures.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Must succeed with strict TypeScript.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

- [ ] **Step 4: Spawn adversarial review subagent**

Use `superpowers:code-reviewer` agent to review the complete changeset for:
- Missed HookRegistry/CheckpointRegistry references
- Uneven AgentContext access patterns
- Public API leaks (internal symbols still exposed)
- Test coverage gaps

- [ ] **Step 5: Fix issues found by adversarial review**

- [ ] **Step 6: Final commit**
