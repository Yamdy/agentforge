# AgentForge Developer Guide

## Project Overview

Agent framework based on RxJS event stream + Zod type safety.  
Core pattern: `Observable<AgentEvent>` stream with expand recursion.

## Essential Commands

```bash
npm run build      # tsc (compiles to dist/)
npm run test       # vitest run (all tests, ~345 tests)
npm run test:watch # vitest watch mode
npm run lint       # eslint src --ext .ts
npm run lint:fix   # eslint src --ext .ts --fix
npm run format     # prettier --write "src/**/*.ts"
npm run clean      # rimraf dist
```

## TypeScript Strictness (Critical)

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noUncheckedIndexedAccess": true,   // arr[0] is T | undefined
  "exactOptionalPropertyTypes": true, // foo?: string means omit only
  "verbatimModuleSyntax": true        // type imports need 'type' keyword
}
```

## Import Conventions (MUST Follow)

```typescript
// Local imports: ALWAYS use .js extension (verbatimModuleSyntax)
import { AgentEvent } from '../core/index.js';  // Correct
import { AgentEvent } from '../core/index';     // WRONG

// Type-only imports: use 'type' keyword
import type { LLMAdapter } from './interfaces.js';
import { type AgentEvent, isTerminalEvent } from './events.js';
```

## Architecture Patterns

### 1. Event Stream + Expand Recursion
```
run() → Observable<AgentEvent>
   └── expand(step)        // Recursive step processing
       └── step(event) → Observable<StepContext>
           └── handlers return events + state
```

**Key**: `StepContext = { event, state }` - state is passed through, never mutated.

### 2. Errors-as-Events (Never RxJS throws)
```typescript
// LLM/tool errors become events:
catchError(error => from([
  { event: { type: 'agent.error', error: serializeError(error) } },
  { event: { type: 'done', reason: 'error' } },
]))
```

### 3. Async RxJS Pattern (CRITICAL - Avoids Event Loss)
```typescript
// WRONG: Direct Promise in expand causes duplication
expand(() => promise)

// CORRECT: Wrap Promise properly
from(promise).pipe(mergeMap(arr => from(arr)))
```

### 4. Terminal Events Return EMPTY
```typescript
if (isTerminalEvent(event)) return EMPTY; // 'done', 'agent.error', 'cancel'
```

### 5. Validation Tiers
- **Tier 1** (external): LLM/MCP/User input → `safeParse` + graceful degradation, NEVER crash
- **Tier 2** (boundaries): Checkpoint/event bus → compile-time schema
- **Tier 3** (internal): TypeScript types only

## Key Modules

| Path | Purpose |
|------|---------|
| `src/core/events.ts` | 50+ Zod event schemas (discriminated union on `type`) |
| `src/core/state.ts` | AgentState + immutable update helpers |
| `src/core/interfaces.ts` | DI interfaces (LLMAdapter, ToolRegistry, HITLController, etc.) |
| `src/loop/agent-loop.ts` | Core agent loop (~1080 lines, expand recursion) |
| `src/contracts/` | Tier 1 validation with graceful degradation |
| `src/operators/` | Custom RxJS operators (filterEventType, takeUntilTerminal, etc.) |
| `src/core/state-machine.ts` | 6-state lifecycle (pending→running→paused/completed/error/cancelled) |

## Event Routing (Active Events)

```
agent.start → agent.step + llm.request
llm.request → callLLM() → llm.response
llm.response → tool.call[] or agent.complete
tool.call → tool.execute + tool.result
tool.result → agent.step + llm.request (loop)
llm.output.invalid → retry or agent.error (repair loop)
hitl.ask → Observable subscription (NEVER-blocking until answer arrives)
hitl.answer → EMPTY (pure observability)
```

**Note**: HITL uses Observable-based async pattern. The `hitl.ask` case subscribes to `ctx.hitl.ask()` which pauses the expand recursion. External UI calls `answer()` to resume.

## State Machine

```
pending → [running]
running → [paused, completed, cancelled, error]
paused → [running, cancelled]
completed/cancelled/error → [] (terminal, irreversible)
```

## Testing

- Vitest with `globals: true` (describe/it/expect available without import)
- Tests mirror src structure: `tests/core/`, `tests/loop/`, `tests/contracts/`
- Mock patterns: see `tests/loop/agent-loop.spec.ts` for `MockLLMAdapter`, `MockToolRegistry`

## DI Pattern (No IoC Container)

- Dependency Inversion: core depends on interfaces
- Context closure: dependencies passed via closure, NOT event payloads
- `AgentContext` contains all services; `StepContext` = {event, state}

## Common Gotchas

1. **Array access**: Use `arr[0]!` or `arr[0] ?? default` (noUncheckedIndexedAccess)
2. **Optional fields**: `foo?: string` means omit or string, NOT `string | undefined`
3. **Checkpoint saves**: Fire-and-forget, never blocks event flow
4. **HITL**: Uses Observable-based async pattern. `ctx.hitl.ask()` returns `Observable<string>` that pauses the expand recursion until answer arrives. UI subscribes to `onAsk()` and calls `answer()` when human responds. Uses `observeOn(asyncScheduler)` to avoid synchronous deadlocks.
5. **RxJS imports**: Split `'rxjs'` (Observable, of, from, EMPTY, Subject, NEVER, asyncScheduler) and `'rxjs/operators'` (expand, map, observeOn, etc.)
6. **Errors-as-events**: ALL errors must become `agent.error` + `done` events. Never use `subscriber.error()` or RxJS error channel. Even re-entry guard uses this pattern.
7. **Pause**: Uses `onResume()` Observable — functionally equivalent to `NEVER` + external resume signal, avoids memory leaks (no bufferToggle).

## Documentation

- Design doc: `docs/architecture/RXJS-EVENT-STREAM-DESIGN.md` (~8900 lines)
- Project status: `.sisyphus/handoff.md`

## Node Version

Requires Node.js >= 18.0.0

## Future Work

### Potential Enhancements

1. **Layer 2 Events**: SubAgent/MCP/Workflow lifecycle events not yet implemented
2. **Real LLM Adapters**: OpenAI/Anthropic production adapters (current: mock for testing)
3. **Performance Metrics**: Built-in timing and throughput tracking

### Completed Previously

- **HITL Observable Pattern**: Now uses `Observable<string>` with `observeOn(asyncScheduler)` to enable true stream-based pause/resume. UI subscribes to `onAsk()`, answers via `answer()`.
- **Husky + lint-staged**: Pre-commit hooks for code quality (see Git Hooks section).

## Git Hooks

Pre-commit and pre-push hooks are configured via Husky + lint-staged:

### Pre-commit Hook
Runs lint-staged on staged files:
- `*.ts` files: `eslint --fix` → `prettier --write`
- `*.{json,md}` files: `prettier --write`

### Pre-push Hook
Runs build + tests before pushing:
```bash
npm run build && npm test
```

### Bypassing Hooks (Emergency Only)
```bash
git commit --no-verify   # Skip pre-commit
git push --no-verify     # Skip pre-push
```
