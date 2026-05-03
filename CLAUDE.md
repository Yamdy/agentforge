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
      ├── run checkpoint phase 'pre-llm' (quota, rate-limit)
      ├── await llm.chat(messages, tools)
      ├── run checkpoint phase 'post-llm' (quality gate, circuit breaker)
      ├── if tool_calls: await execute tools → emit results → loop back
      └── if response: return output text
```

The agent loop (`src/loop/agent-loop.ts`, ~1080 lines) is a single closure with all control flow inline — no event-type switch, no handler delegation. `AgentState` is mutable and passed by reference through the loop.

### 2. Layer Architecture

```
L1 (Zero-code)  → JSON/JSONC config → Agent        (src/l1/)
L2 (Config API) → createAgent(config)                (src/api/create-agent.ts)
L3 (Programmatic)→ ContextBuilder + createAgentLoop   (src/api/context-builder.ts, src/loop/agent-loop.ts)
```

`src/api/create-agent.ts` builds the full wiring: resolves config, creates LLM adapter, builds AgentContext, registers tools/plugins/hooks, creates the loop, and returns the Agent interface.

### 3. Event System

All events are Zod-validated discriminated unions on `type`. Three layers:
- **Layer 1**: Core loop events (`agent.start`, `llm.request`, `tool.call`, `done`, etc.)
- **Layer 2**: Subsystem lifecycle (`subagent.start`, `mcp.connected`, `workflow.start`)
- **Layer 3**: Cross-cutting (`compaction.start`, `permission.prompt`)

Terminal events (`done`, `agent.error`, `cancel`) return EMPTY.

### 4. Errors-as-Events (Never throw through event channel)

```typescript
catch (error) {
  emitter.emit({ type: 'agent.error', error: serializeError(error) });
  emitter.emit({ type: 'done', reason: 'error' });
}
// NEVER: throw error + also emit error (double-reporting bug)
```

### 5. Hook System (3 types)

Hooks are cut-points where plugins register behavior. All hook errors are silently caught — plugin isolation is safety-critical.

| Hook Type | Purpose | Interface |
|-----------|---------|-----------|
| **RequestHook** | Modify LLM messages before each call | `apply(messages[], state) → messages[]` |
| **ToolHook** | Block/allow tool execution | `beforeExecute(toolCall, state) → boolean` |
| **LifecycleHook** | Observe at key cut-points | `(input, output) → void` |

Request hooks have standard priority tiers (lower = earlier): SYSTEM_RULES(10) → MEMORY_CONTEXT(20) → WORKING_MEMORY(25) → SKILL_INSTRUCTIONS(30) → TOOL_DESCRIPTIONS(40) → USER_CUSTOM(50).

### 6. CheckpointRegistry (R6 Iron Law)

Cross-cutting concerns (quota, rate-limit, quality gate, circuit breaker) register for lifecycle phases declaratively. The agent loop calls `registry.run(phase, ctx, state)` at each checkpoint. **Never** hardcode `if (ctx.X)` gates in the loop.

Lifecycle phases: `pre-llm`, `post-llm`, `pre-tool`, `post-tool`, `on-error`, `on-input`.

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
- Three-layer context: `ApplicationServices` (global) → `AgentContext` (per-session) → `ToolContext` (per-tool-execution)

## Key Modules

| Path | Role |
|------|------|
| `src/core/events.ts` | 50+ Zod event schemas, AgentEventEmitter (50-line impl), type guards |
| `src/core/state.ts` | AgentState + immutable update helpers |
| `src/core/interfaces.ts` | DI interfaces (LLMAdapter, ToolRegistry, HITLController, etc.) |
| `src/core/hooks.ts` | HookRegistry with RequestHook/ToolHook/LifecycleHook |
| `src/core/checkpoint-registry.ts` | Declarative cross-cutting concern wiring (R6) |
| `src/core/state-machine.ts` | 6-state lifecycle with transition validation |
| `src/loop/agent-loop.ts` | Core agent loop — while(true) + await, all control flow inline |
| `src/loop/token-budget.ts` | Token budget management + compaction triggers |
| `src/loop/error-analyzer.ts` | LLM error classification + recovery escalation |
| `src/loop/tool-partition.ts` | Tool concurrency safety partitioning |
| `src/api/create-agent.ts` | L2 config-driven Agent factory |
| `src/adapters/` | LLM provider adapters (OpenAI, Anthropic, Google, Ollama, OpenAI-compatible) |
| `src/contracts/` | Tier 1 validation with graceful degradation |
| `src/memory/` | Compaction, semantic memory, vector stores, working memory |

## Testing

- Vitest with `globals: true` — describe/it/expect available without imports
- Tests mirror src: `tests/core/`, `tests/loop/`, `tests/contracts/`, etc.
- Mock patterns: `MockLLMAdapter`, `MockToolRegistry` in `tests/loop/agent-loop.spec.ts`
- Timeout: 60s for both tests and hooks

## Common Gotchas

1. **Array access**: `arr[0]` is `T | undefined` (noUncheckedIndexedAccess). Use `arr[0]!` or `arr[0] ?? default`.
2. **Optional fields**: `foo?: string` means "omit or string", NOT "string | undefined" (exactOptionalPropertyTypes).
3. **HITL**: Uses callback-based async — `ctx.hitl.ask()` returns a Promise, UI calls `answer()` to resolve.
4. **Pause**: `onResume()` returns a cleanup function to prevent memory leaks.
5. **Checkpoint saves**: Fire-and-forget, never blocks the event flow.
6. **AgentEventEmitter**: Simple 50-line implementation. `on()`/`onAny()`/`emit()`. All return unsubscribe functions.
7. **`as any` is forbidden** (`no-explicit-any: "error"`). The only exception is the plugin pipeline files which have explicit eslint overrides.

## Design Documentation

- `docs/design/00-OVERVIEW.md` — 15 iron laws (5 architecture + 6 runtime + 4 implementation)
- `docs/design/README.md` — full design doc index
