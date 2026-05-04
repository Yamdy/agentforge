# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AgentForge is an **Agent Harness framework** — a safety/control layer that wraps AI agents, not a new agent framework. The core philosophy: Agent = LLM (cognitive decisions) + Harness (engineering controls). All agent behavior must pass through Harness controls.

Built on **event-driven architecture + Zod type safety**. Uses an imperative `while(true)` loop with `AgentEventEmitter`, not recursive expand or stream-driven patterns.

## Essential Commands

```bash
npm run build          # tsc — compiles src/ to dist/
npm run test           # vitest run — all tests (globals: true — describe/it/expect auto-available)
npm run test:watch     # vitest watch mode
npx vitest tests/core/events.spec.ts   # run a single spec file
npx vitest tests/core/events.spec.ts -t "isAgentEvent"  # run a single test by name
npm run test:coverage  # vitest run --coverage
npm run lint           # eslint src --ext .ts
npm run lint:fix       # eslint src --ext .ts --fix
npm run format         # prettier --write "src/**/*.ts"
npm run clean          # rimraf dist
```

## TypeScript Strictness (Critical — tsc will fail otherwise)

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noUncheckedIndexedAccess": true,   // arr[0] returns T | undefined
  "exactOptionalPropertyTypes": true, // foo?: string means omit OR string, NOT string | undefined
  "verbatimModuleSyntax": true        // type imports require 'type' keyword
}
```

## Import Conventions (MUST follow — verbatimModuleSyntax)

```typescript
// Local imports: ALWAYS use .js extension
import { AgentEvent } from '../core/index.js';  // Correct
import { AgentEvent } from '../core/index';     // WRONG — will fail

// Type-only imports: use 'type' keyword
import type { LLMAdapter } from './interfaces.js';
import { type AgentEvent, isTerminalEvent } from './events.js';
```

## Architecture — The Big Picture

### 1. Imperative Loop + Event Emitter

```
run(input) → Promise<string>
  └── while(true) loop
      ├── apply request hooks → modify messages
      ├── run checkpoint phase 'pre-llm' (quota, rate-limit via Plugin.checkpointHooks)
      ├── await llm.chat(messages, tools)
      ├── run checkpoint phase 'post-llm' (quality gate, circuit breaker via Plugin.checkpointHooks)
      ├── if tool_calls: await execute tools → emit results → loop back
      └── if response: return output text
```

The agent loop (`src/loop/agent-loop.ts`, ~1080 lines) is a single closure with all control flow inline — no event-type switch, no handler delegation. `AgentState` is mutable and passed by reference through the loop. Cross-cutting concerns register via Plugin checkpoint hooks, not hardcoded `if (ctx.X)` gates.

### 2. Layer Architecture

```
L1 (Zero-code)  → JSON/JSONC config → Agent        (src/l1/)
L2 (Config API) → createAgent(config)                (src/api/create-agent.ts)
L3 (Programmatic)→ ContextBuilder + createAgentLoop   (src/api/context-builder.ts, src/loop/agent-loop.ts)
```

`src/api/create-agent.ts` builds the full wiring: resolves config, creates LLM adapter, builds grouped AgentContext, registers tools and plugins (checkpoint hooks auto-registered via Plugin pipeline), creates the loop, and returns the Agent interface.

### 3. Event System

All events are Zod-validated discriminated unions on `type`. Three layers:
- **Layer 1**: Core loop events (`agent.start`, `llm.request`, `tool.call`, `done`, etc.)
- **Layer 2**: Subsystem lifecycle (`subagent.start`, `mcp.connected`, `workflow.start`)
- **Layer 3**: Cross-cutting (`compaction.start`, `permission.prompt`)

Terminal events (`done`, `agent.error`, `cancel`) return EMPTY.

**AgentEventEmitter is internal-only.** Users never interact with it directly — event subscriptions go through `Plugin.eventSubscriptions`. Only `on()`, `onAny()`, and `emit()` are used internally; event type guards (`isAgentEvent`, `isLLMEvent`, `isToolEvent`, `isTerminalEvent`) are exported for external consumers.

### 4. Errors-as-Events (Never throw through event channel)

```typescript
catch (error) {
  emitter.emit({ type: 'agent.error', error: serializeError(error) });
  emitter.emit({ type: 'done', reason: 'error' });
}
// NEVER: throw error + also emit error (double-reporting bug)
```

### 5. Plugin System — The One True Extension API

**Plugin is the sole public extension mechanism.** All cross-cutting behavior registers through a single `Plugin` interface. HookRegistry, CheckpointRegistry, and EventEmitter are internal implementation details — never exported to users.

A Plugin can register 6 kinds of hooks:

| Hook Type | Purpose | Interface |
|-----------|---------|-----------|
| **requestHooks** | Modify LLM messages before each call | `apply(messages[], state) → messages[]` |
| **toolHooks** | Block/allow tool execution | `beforeExecute(toolCall, state) → boolean` |
| **toolProviderHooks** | Dynamically provide tool definitions | `getTools() → ToolDefinition[]` |
| **lifecycleHooks** | Observe at key cut-points | `(input, output) → void` |
| **checkpointHooks** | Register for lifecycle phases (pre-llm, post-llm, etc.) | `{ phase, fn(ctx, state) → CheckpointResult }` |
| **eventSubscriptions** | Subscribe to event emitter events | `{ event: AgentEventType, handler(event) → void }` |

All hook errors are silently caught — plugin isolation is safety-critical.

Request hooks have standard priority tiers (lower = earlier): SYSTEM_RULES(10) → MEMORY_CONTEXT(20) → WORKING_MEMORY(25) → SKILL_INSTRUCTIONS(30) → TOOL_DESCRIPTIONS(40) → USER_CUSTOM(50).

Built-in plugin factories (exported from main entry): `createQuotaPlugin`, `createRateLimitPlugin`, `createQualityGatePlugin`, `createCircuitBreakerPlugin`, `createMemoryPlugin`, `createSkillsPlugin`, `createSummarizationPlugin`, `createTodoListPlugin`, `loggingPlugin`, `metricsPlugin`.

### 6. Checkpoint Hooks (R6 Iron Law — via Plugin)

Cross-cutting concerns (quota, rate-limit, quality gate, circuit breaker) register for lifecycle phases via `Plugin.checkpointHooks`. The agent loop runs all registered checkpoint hooks at each phase. **Never** hardcode `if (ctx.X)` gates in the loop.

Lifecycle phases: `pre-llm`, `post-llm`, `pre-tool`, `post-tool`, `on-error`, `on-input`.

Each checkpoint hook returns a `CheckpointResult`: `{ action: 'continue' | 'abort' | 'retry'; reason?: string }`. The loop respects the most severe action across all hooks.

```typescript
// Example: Quota as a Plugin checkpoint hook
const quotaPlugin: Plugin = {
  name: 'quota',
  checkpointHooks: [{
    phase: 'pre-llm',
    priority: 10,
    fn: async (ctx, state) => {
      if (ctx.controls.quota && !(await ctx.controls.quota.check()).allowed) {
        return { action: 'abort', reason: 'quota-exceeded' };
      }
      return { action: 'continue' };
    },
  }],
};
```

### 7. Validation Tiers

- **Tier 1** (external): LLM/MCP/User input → `safeParse` + graceful degradation, NEVER crash
- **Tier 2** (boundaries): Checkpoint/event bus → compile-time schema
- **Tier 3** (internal): TypeScript types only

### 8. State Machine

```
pending → [running]
running → [paused, completed, cancelled, error]
paused → [running, cancelled]
completed/cancelled/error → [] (terminal, irreversible)
```

### 9. DI Pattern (No IoC container)

- Dependency inversion: core loop depends on interfaces, not implementations
- Context closure: dependencies passed via `AgentContext`, not event payloads
- Three-layer context: `ApplicationServices` (global) → `AgentContext` (per-session, 8 sub-objects) → `ToolContext` (per-tool-execution)

**AgentContext structure (8 sub-objects):**

| Sub-object | Key Fields | Scope |
|-----------|-----------|-------|
| `ctx.identity` | `sessionId`, `agentName`, `runId`, `parentRunId` | Per-session identity |
| `ctx.core` | `llm`, `tools`, `memory`, `services`, `logger`, `hooks`, `pauseController` | Core engine dependencies |
| `ctx.security` | `securityGuard`, `permissionController`, `permissionPolicy`, `sandboxExecutor`, `auditLogger`, `rateLimiter`, `inputSanitizer` | Security controls |
| `ctx.controls` | `hitl`, `quota`, `qualityGate`, `circuitBreaker`, `errorClassifier`, `pauseController`, `abortSignal` | Runtime controls |
| `ctx.memory` | `semanticMemory`, `vectorStore` | Long-term memory |
| `ctx.resilience` | `errorClassifier`, `circuitBreaker`, `fallbackHandler` | Error resilience |
| `ctx.extensions` | `planner`, `subagents`, `mcp`, `a2a` | Optional subsystems |
| `ctx.harness` | `hooks`, `emitter`, `state`, `executionMode` | Harness internals |

**Builder pattern:** Both `ContextBuilder` (L3) and `AgentContextBuilder` (L2 API) use flat `BuilderState` internally and produce grouped `AgentContext` in `.build()`. The `createAgent()` L2 API accepts `FlatServiceOverrides` (legacy flat field names) via `normalizeServices()` for backward compatibility.

## Key Modules

| Path | Role |
|------|------|
| `src/core/events.ts` | 50+ Zod event schemas, AgentEventEmitter (internal-only), type guards |
| `src/core/state.ts` | AgentState + immutable update helpers |
| `src/core/interfaces.ts` | DI interfaces (LLMAdapter, ToolRegistry, HITLController, etc.) |
| `src/core/hooks.ts` | HookRegistry + Hook types (RequestHook, ToolHook, CheckpointHook, etc.) — internal |
| `src/core/context.ts` | AgentContext (8 sub-objects), ApplicationServices, ToolContext |
| `src/core/context-builder.ts` | ContextBuilder (L3) — BuilderState flat → AgentContext grouped |
| `src/core/state-machine.ts` | 6-state lifecycle with transition validation |
| `src/loop/agent-loop.ts` | Core agent loop — while(true) + await + Plugin checkpoint hooks |
| `src/loop/token-budget.ts` | Token budget management + compaction triggers |
| `src/loop/tool-executor.ts` | Tool execution pipeline: ToolHook → Permission → Security → Sandbox → Execute |
| `src/loop/error-analyzer.ts` | LLM error classification + recovery escalation |
| `src/loop/tool-partition.ts` | Tool concurrency safety partitioning |
| `src/api/create-agent.ts` | L2 config-driven Agent factory with normalizeServices() backward compat |
| `src/api/context-builder.ts` | AgentContextBuilder (L2) — maps flat overrides to grouped context |
| `src/plugins/` | Plugin interface + built-in plugin factories (memory, skills, logging, etc.) |
| `src/adapters/` | LLM provider adapters (OpenAI, Anthropic, Google, Ollama, OpenAI-compatible) |
| `src/contracts/` | Tier 1 validation with graceful degradation |
| `src/memory/` | Compaction, semantic memory, vector stores, working memory |
| `src/index.ts` | Curated public API (~69 symbols, 7 categories) |
| `src/l1/` | L1 zero-code JSON/JSONC config → Agent |

## Public API (~69 symbols from `agentforge`)

The main entry (`src/index.ts`) exports a curated subset organized in 7 categories. Internal implementation details (HookRegistry, EventEmitter, CheckpointRegistry, InProcessSandboxExecutor, etc.) are NOT exported.

**Agent Creation (L2 API):** `createAgent`, `Agent`, `AgentConfig`, `NormalizedAgentConfig`, `RunHandlers`, `StreamHandlers`, `PluginSpec`, `AgentConfigError`

**Plugin System:** `Plugin`, `PluginContext`, `RequestHook`, `ToolHook`, `ToolProviderHook`, `CheckpointHook`, `CheckpointResult`, `CheckpointFn`, `LifecyclePhase`, `LifecycleHookEntry`, `HookName`, `RequestHookPriority`, plus 10 built-in plugin factories (`createQuotaPlugin`, `createMemoryPlugin`, `createSkillsPlugin`, `loggingPlugin`, `metricsPlugin`, etc.)

**Events:** `AgentEvent`, `AgentEventType`, `Message`, `ToolCall`, `SerializedError`, `FinishReason`, plus type guards (`isAgentEvent`, `isLLMEvent`, `isToolEvent`, `isTerminalEvent`, `serializeError`, `generateId`)

**Core Types:** `AgentContext`, `LLMAdapter`, `LLMResponse`, `LLMUsage`, `ToolDefinition`, `ToolRegistry`, `AgentState`, `CreateInitialStateOptions`, `createInitialState`, `updateState`

**L3 API:** `ContextBuilder`, `createApplicationServices`, `AgentLoop`, `AgentLoopConfig`, `createAgentLoop`

**LLM Adapters:** `createLLMAdapter`, `parseModelSpec`, `LLMAdapterFactoryImpl`

**Utilities:** `CompactionManager`, `createCompactionManager`, `tool`, `TokenCounter`, `countTokens`, `extractText`, `hasImages`, `isContentArray`

### Sub-path Imports

For full subsystem access, use sub-path imports defined in `package.json` exports map:

```typescript
import { ... } from 'agentforge/core';       // All core types, events, hooks, state
import { ... } from 'agentforge/loop';        // Agent loop + sub-modules
import { ... } from 'agentforge/memory';      // Compaction, semantic memory, vector stores
import { ... } from 'agentforge/adapters';    // All LLM provider adapters
import { ... } from 'agentforge/evaluation';  // Evaluation framework
import { ... } from 'agentforge/l1';          // L1 zero-code config layer
```

Sub-paths export their full subsystem surface — use them when you need internal types not in the curated main entry.

## Testing

- Vitest with `globals: true` — describe/it/expect available without imports
- Tests mirror src: `tests/core/`, `tests/loop/`, `tests/contracts/`, etc.
- Mock patterns: `MockLLMAdapter`, `MockToolRegistry` in `tests/loop/agent-loop.spec.ts`
- Timeout: 60s for both tests and hooks

## Common Gotchas

1. **Array access**: `arr[0]` is `T | undefined` (noUncheckedIndexedAccess). Use `arr[0]!` or `arr[0] ?? default`.
2. **Optional fields**: `foo?: string` means "omit or string", NOT "string | undefined" (exactOptionalPropertyTypes).
3. **HITL**: Uses callback-based async — `ctx.controls.hitl.ask()` returns a Promise, UI calls `answer()` to resolve.
4. **Pause**: `ctx.core.pauseController.onResume()` returns a cleanup function to prevent memory leaks.
5. **Checkpoint saves**: Fire-and-forget via Plugin checkpointHooks, never blocks the event flow.
6. **AgentEventEmitter**: Internal-only. Simple ~50-line implementation. `on()`/`onAny()`/`emit()`. All return unsubscribe functions. Users subscribe via `Plugin.eventSubscriptions`, never directly.
7. **`as any` is forbidden** (`no-explicit-any: "error"`). The only exception is the plugin pipeline files which have explicit eslint overrides.
8. **AgentContext is grouped**: Access via sub-objects — `ctx.core.llm`, `ctx.security.securityGuard`, `ctx.controls.hitl`, `ctx.identity.sessionId`. Flat access (`ctx.llm`, `ctx.sessionId`) will fail type-check.
9. **Public API is curated**: Only ~69 symbols exported from `agentforge`. Internal types (HookRegistry, EventEmitter, CheckpointRegistry) are NOT exported. For full subsystem access, use sub-path imports: `agentforge/core`, `agentforge/loop`, `agentforge/memory`, `agentforge/adapters`, `agentforge/evaluation`, `agentforge/l1`.

## Design Documentation

- `docs/design/00-OVERVIEW.md` — 15 iron laws (5 architecture + 6 runtime + 4 implementation)
- `docs/design/README.md` — full design doc index
