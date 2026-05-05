# Phase 3: Plugin API Deepening Design

> 日期: 2026-05-06
> 目标: 让 Plugin API 强到能支撑 workflow/A2A/session 作为官方插件实现

## 定位

AgentForge 定位类似 Vue — 核心层 + 渐进式生态系统。Plugin API 是"唯一扩展入口"，官方插件和生态包都通过它构建。阶段三让这个承诺兑现。

## Section 1: LifecyclePhase 三分法

### Before

```typescript
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

三种语义混在同一个扁平枚举中:
- 阻塞型 (pre-llm/post-llm): CheckpointHook 专用，返回 block/continue
- 观察型 (step.begin/tool.before 等): LifecycleHook 专用，fire-and-forget
- 恢复型 (recovery.*/llm.error/tool.error): 错误恢复流程

### After

```typescript
// 阻塞型 — CheckpointHook 专用，能终止循环
export type CheckpointPhase = 'pre-llm' | 'post-llm';

// 观察型 — LifecycleHook 专用，fire-and-forget
export type LifecyclePhase =
  | 'session.start' | 'session.end'
  | 'step.begin' | 'step.end'
  | 'llm.request.before' | 'llm.response.after'
  | 'tool.before' | 'tool.after'
  | 'compaction.before' | 'compaction.after';

// 错误/恢复型 — RecoveryHook 专用
export type RecoveryPhase =
  | 'llm.error' | 'tool.error'
  | 'recovery.escalate' | 'recovery.compact' | 'recovery.fallback'
  | 'error';
```

### Interface Changes

```typescript
// Before
interface CheckpointHook { phase: LifecyclePhase; fn: CheckpointFn; }

// After
interface CheckpointHook { phase: CheckpointPhase; fn: CheckpointFn; }
interface RecoveryHookEntry { phase: RecoveryPhase; fn: RecoveryFn; priority: number; }
```

### Plugin Interface

```typescript
interface Plugin {
  // existing
  checkpointHooks?: CheckpointHook[];    // phase type narrowed to CheckpointPhase
  lifecycleHooks?: LifecycleHookEntry[]; // phase type narrowed to LifecyclePhase
  // new
  recoveryHooks?: RecoveryHookEntry[];   // exclusively for error/recovery phases
}
```

### Files Changed

- src/core/hooks.ts — split types, add RecoveryHookEntry
- src/plugins/plugin.ts — add recoveryHooks to Plugin
- src/loop/agent-loop.ts — three call sites use correct types
- src/loop/error-recovery-handler.ts — use RecoveryPhase
- src/plugins/builtin-checkpoints.ts — phase values narrowed
- src/plugins/logging-plugin.ts — lifecycleHooks narrowed
- src/plugins/metrics-plugin.ts — same
- tests/core/hooks.spec.ts — type guard tests

---

## Section 2: PluginContext Expansion

### Before

```typescript
interface PluginContext {
  readonly sessionId: string;
  readonly agentName: string;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  readonly logger?: Logger;
}
```

### After

```typescript
interface PluginContext {
  // identity
  readonly sessionId: string;
  readonly agentName: string;
  readonly tracer?: Tracer;
  readonly metrics?: Metrics;
  readonly logger?: Logger;

  // new capabilities
  readonly emitter: AgentEventEmitter;       // emit custom events
  getState(): Readonly<AgentState>;          // read-only state snapshot
  listTools(): ToolDefinition[];             // registered tool descriptions
  addMessages(messages: Message[]): void;    // inject messages into conversation
}
```

### Design Rationale

| Capability | Use Case | Why Not via Existing Hooks |
|-----------|----------|---------------------------|
| emitter | Workflow plugin emits `workflow.step.complete`; A2A emits `subagent.invoke` | requestHooks/toolHooks consume only, don't produce |
| getState() | Quota check needs current token count; workflow needs current step number | checkpointHooks get state, but lifecycleHooks and eventHandlers don't |
| listTools() | Workflow checks available tools; A2A filters delegatable tools | toolProviderHooks trigger at LLM call time, not on-demand |
| addMessages() | Workflow injects "continue with step 3" system message | requestHooks modify existing, can't inject new messages mid-loop |

### Security Boundaries (NOT Exposed)

- llm: LLMAdapter — plugins must not call LLM directly
- tools (execute) — listTools returns definitions only, cannot execute
- memory (write) — influence through addMessages + requestHooks
- checkpoint: CheckpointStorage — framework responsibility

### Files Changed

- src/plugins/plugin.ts — extend PluginContext, update createPluginContext()
- src/plugins/manager.ts — inject new fields during plugin init
- src/api/create-agent.ts — pass emitter + closures to createPluginContext
- src/loop/agent-loop.ts — expose message queue write point for addMessages
- tests/plugins/plugin-context.spec.ts — NEW: 4 capability E2E verification

### Test Scenarios

1. emitter: Plugin A emits event, Plugin B receives via eventSubscriptions
2. getState(): lifecycleHook reads current step count
3. listTools(): matches ToolRegistry, cannot execute
4. addMessages(): injected messages visible in next LLM call's requestHooks
5. addMessages pipeline: injected messages pass through requestHooks (security)

---

## Section 3: ToolProviderHook/ToolHook Unification

### Before (Two Separate Mechanisms)

```typescript
// llm-caller.ts — filter tool definitions before LLM call
interface ToolProviderHook {
  name: string; priority: number;
  filter(tools: FunctionDefinition[], state: AgentState): FunctionDefinition[];
}

// tool-executor.ts — check before execution
interface ToolHook {
  name: string;
  beforeExecute(toolCall: ToolCall, state: AgentState): boolean;
}
```

### After (Single Unified Interface)

```typescript
interface ToolHook {
  name: string;
  priority: number;

  // Optional — filter/inject tool definitions before LLM call
  filter?(tools: FunctionDefinition[], state: AgentState): FunctionDefinition[];

  // Optional — check/modify tool call before execution
  beforeExecute?(toolCall: ToolCall, state: AgentState):
    | { action: 'allow' }
    | { action: 'block'; reason: string }
    | { action: 'modify'; args: Record<string, unknown> };
}
```

### Key Changes

| Old | New |
|-----|-----|
| Two separate registration points | Single `plugin.toolHooks: ToolHook[]` |
| beforeExecute returns boolean | Returns `{action, reason?, args?}` — richer typing |
| No parameter modification | `{action: 'modify', args}` — workflow can inject stepId |
| Injected tools skip ToolHook | All tools go through beforeExecute |

### Files Changed

- src/core/hooks.ts — merge interfaces, add ToolBeforeResult
- src/plugins/plugin.ts — remove toolProviderHooks field, update toolHooks type
- src/loop/llm-caller.ts — call hook.filter() instead of old toolProviderHook.filter()
- src/loop/tool-executor.ts — call hook.beforeExecute(), handle new return type
- src/plugins/builtin-checkpoints.ts — update implementations
- tests/core/hooks.spec.ts — unified flow tests
- tests/loop/agent-loop.spec.ts — update mock tool hooks

### Test Scenarios

1. filter removes dangerous tool → LLM doesn't see it → beforeExecute not called
2. beforeExecute modify → tool args changed → tool receives modified args
3. beforeExecute block → tool skipped → loop emits tool.error
4. Hook has both filter and beforeExecute → filter runs before beforeExecute
5. Injected tools also pass through beforeExecute (old bug verification)

---

## Section 4: Streaming Chunks via Event System

### Before

onChunk is a lightweight callback `(chunk: string) => void`, bypassing AgentEventEmitter.
Plugins cannot subscribe to streaming chunks. iterate() AsyncGenerator doesn't yield them.

### After

```typescript
// events.ts
class AgentEventEmitter {
  emit(event: AgentEvent): void;              // existing — Zod-validated
  emitChunk(delta: string, metadata?: { index: number }): void;  // new — fast path
  on(event: 'llm.chunk', handler: (chunk: LLMChunkEvent) => void): () => void;
}

interface LLMChunkEvent {
  type: 'llm.chunk';
  delta: string;
  index: number;
  timestamp: number;
}
```

### Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Separate emitChunk vs emit | Separate | Streaming fires 10s of times/sec; Zod overhead is real |
| Zod validation for chunks | No | TypeScript type sufficient. chunk is string + index + timestamp |
| onChunk callback | Preserved, forwarded | Backward compat. onChunk calls emitter.emitChunk() internally |
| llm.chunk in AgentEventTypeSchema z.enum | No | Avoids Zod parse path for chunks |
| Plugin subscription | Same interface | `eventSubscriptions: [{ event: 'llm.chunk', handler }]` |

### Data Flow

```
LLM stream token → onChunk callback (preserved)
                 → emitter.emitChunk(delta, { index })
                    ├─ emitter.on('llm.chunk') → Plugin subscribers
                    └─ bridgeEmitterToGenerator → AgentLoop.iterate() AsyncGenerator
```

### Files Changed

- src/core/events.ts — AgentEventEmitter adds emitChunk(), LLMChunkEvent TS type
- src/loop/llm-caller.ts — onChunk forwards to emitter.emitChunk()
- src/loop/event-iterator.ts — bridgeEmitterToGenerator adapts chunk events
- src/loop/agent-loop.ts — iterate() yields chunk events
- src/plugins/plugin.ts — eventSubscriptions type extended
- tests/core/events.spec.ts — emitChunk fast path + subscribe + unsubscribe
- tests/loop/llm-caller.spec.ts — streaming mock verifies emitChunk called

### Test Scenarios

1. Mock streaming LLM → emitChunk called N times → subscribers receive N events
2. Plugin.eventSubscriptions subscribes to llm.chunk → handler invoked
3. iterate() AsyncGenerator → yields chunk events
4. onChunk callback compat → internally forwarded to emitChunk, behavior identical
5. Performance: 10000 chunks without triggering Zod parse

---

## Section 5: Sub-path Exports Restructuring

### Before (22 paths)

```
./api, ./l1, ./app, ./core, ./loop, ./plugins,
./adapters, ./contracts,
./memory, ./storage,
./security, ./sandbox, ./audit, ./validation,
./planning, ./resilience,
./skill, ./mcp, ./a2a, ./subagent, ./workflow,
./evaluation, ./observability, ./lifecycle,
./integration, ./quota, ./quickstart
```

### After (12 paths)

```
./api          ← L2 createAgent + L1 config + app + integration + quickstart
./core         ← events, hooks, state, context, lifecycle, observability
./loop         ← agent-loop, tool-executor, llm-caller
./plugins      ← Plugin interface + builtin factories + quota
./adapters     ← LLM providers
./contracts    ← Zod contracts + graceful degradation
./security     ← guard, permission, sandbox, audit, validation
./memory       ← compaction, semantic, vector, working-memory, storage
./extensions   ← subagent, mcp, skill (NEW)
./planning     ← task planning engine (stable-internal)
./resilience   ← circuit breaker, error classifier, auto-repairer (stable-internal)
./evaluation   ← LLM-based evaluation
```

### Removals/Merges

| Path | Destination | Reason |
|------|-------------|--------|
| ./l1 | ./api | L1 and L2 are both Agent creation entry points |
| ./app | ./api | Application is Agent container |
| ./sandbox, ./audit | ./security | Security layer sub-components |
| ./storage | ./memory | SQLite storage serves checkpoint/session |
| ./skill, ./mcp, ./subagent | ./extensions | All extend Agent capabilities |
| ./integration | ./api | MPU service factory is API layer helper |
| ./workflow | REMOVED | Phase 4 as official plugin, not in exports |
| ./a2a | REMOVED | Phase 4 as official plugin |
| ./lifecycle, ./observability | ./core | Core infrastructure |
| ./validation | ./security | Security validation layer |
| ./quota | ./plugins | Builtin plugin implementation |
| ./quickstart | ./api | API layer convenience |

### Files Changed

- package.json — exports 22→12
- src/index.ts — update sub-path documentation
- src/extensions/index.ts — NEW: re-export subagent + mcp + skill
- src/security/index.ts — add sandbox + audit re-exports
- src/memory/index.ts — add storage re-export
- src/api/index.ts — add l1 + app + integration + quickstart re-exports
- src/core/index.ts — add lifecycle + observability re-exports
- src/plugins/index.ts — add quota re-export
- tests/ — update import paths (est. ~20 files)

---

## Section 6: Plugin API E2E Test Suite

### New Test Files

```
tests/plugins/
  ├── plugin-context.spec.ts         # NEW — 4 capability contract tests
  ├── plugin-composition.spec.ts     # NEW — multi-plugin collaboration
  └── plugin-e2e-scenarios.spec.ts   # NEW — full Agent run + plugin combinations
```

### Test Matrix

| Dimension | Coverage | File |
|-----------|----------|------|
| Contract tests | emitter, getState, listTools, addMessages — each independently | plugin-context.spec.ts |
| Composition tests | 3 plugins (quota + custom + logging) in one agent run, no interference | plugin-composition.spec.ts |
| Scenario tests | Mini-workflow as Plugin: step switching, message injection, event listening | plugin-e2e-scenarios.spec.ts |
| Regression | 2455 existing tests stay green | All existing files |

### Key Scenario: Mini-workflow as Plugin

Proves the Plugin API can support workflow-like behavior without core loop changes:

1. Create workflow plugin: lifecycleHook injects plan prompt at step.begin
2. Create observer plugin: eventSubscription listens for workflow.step events
3. Run agent: MockLLM returns planning → tool_calls → final answer
4. Assert:
   - workflow plugin's emitter fired `workflow.step.complete` events
   - observer plugin received 3 step events
   - getState() returned correct step count at each step
   - addMessages() injected plan messages appeared in LLM requests

### Performance Test

Verify emitChunk handles 10000 tokens without Zod overhead — compare against hypothetical emit() path.

---

## Impact Summary

| Section | Source Files | Test Files | Breaking? |
|---------|-------------|------------|-----------|
| 1. LifecyclePhase | 7 | 1 | CheckpointHook phase type narrowed (type-only) |
| 2. PluginContext | 4 | 1 (new) | createPluginContext() signature change |
| 3. ToolHook unified | 5 | 2 | toolProviderHooks removed from Plugin |
| 4. Streaming chunks | 5 | 2 | None (additive) |
| 5. Exports | 10+ | ~20 | Import path changes |
| 6. E2E tests | 0 | 3 (new) | None |
