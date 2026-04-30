# AgentForge Developer Guide

## Project Overview

Agent framework based on event-driven architecture + Zod type safety.  
Core pattern: imperative `while(true)` loop with `AgentEventEmitter`.

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

### 1. Imperative Loop + AgentEventEmitter
```
run() → Promise<string>
   └── while(true) loop     // Imperative step processing
       └── await llm.chat() → await tools.execute() → checkpoint
           └── AgentEventEmitter.emit() for observability
```

**Key**: `AgentLoopState` is mutable, passed by reference through the loop.

### 2. Errors-as-Events (Never throw through event channel)
```typescript
// LLM/tool errors become events:
catch (error) {
  emitter.emit({ type: 'agent.error', error: serializeError(error) });
  emitter.emit({ type: 'done', reason: 'error' });
}
```

### 3. Hook System (Replaces RxJS operators)
```typescript
// RequestHook — modify LLM messages before chat
// ToolHook — check permissions before tool execution
// LifecycleHook — callbacks at key lifecycle points
// eventSubscriptions — observe via AgentEventEmitter.on()
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
| `src/core/hooks.ts` | HookRegistry (RequestHook/ToolHook/LifecycleHook) |
| `src/core/state.ts` | AgentLoopState (imperative loop state) |
| `src/core/state-machine.ts` | 6-state lifecycle (pending→running→paused/completed/error/cancelled) |
| `src/l1/` | **L1 API** - Zero-code config layer (JSON/JSONC → Agent) |
| `src/token-counter.ts` | **Token counting** - js-tiktoken BPE + CJK heuristic fallback |

## Multi-turn Conversation (History)

AgentConfig supports `history?: Message[]` for multi-turn conversation context:

```typescript
const agent = createAgent({
  name: 'assistant',
  model: { provider: 'openai', model: 'gpt-4o' },
  history: [
    { role: 'user', content: 'What is TypeScript?' },
    { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
  ],
});
```

**How it works**:
- `AgentConfig.history` is passed to `AgentLoopConfig.history`
- `createAgentLoop` stores history in the loop config
- `run()` prepends history messages to initial `AgentState.messages`
- LLM receives `[...history, currentUserMessage]` as context

**Files involved**:
- `src/api/types.ts` - `AgentConfig.history?: Message[]`
- `src/loop/agent-loop.ts` - `AgentLoopConfig.history?: Message[]` + `run()` implementation
- `src/api/create-agent.ts` - Passes history from config to loop

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

**Note**: HITL uses callback-based async pattern. The loop awaits `ctx.hitl.ask()` which returns a Promise. External UI calls `answer()` to resolve.

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
4. **HITL**: Uses callback-based async pattern. `ctx.hitl.ask()` returns Promise. UI subscribes to `onAsk()` and calls `answer()` when human responds.
5. **AgentEventEmitter**: 50-line implementation replacing rxjs. `on()`/`onAny()`/`emit()`. All imports use `.js` extension (verbatimModuleSyntax).
6. **Errors-as-events**: ALL errors must become `agent.error` + `done` events. Never use throw/exceptions for expected errors. Even re-entry guard uses this pattern.
7. **Pause**: Uses Promise-based `onResume()` — returns cleanup function, avoids memory leaks.

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

- **Event-Driven Architecture**: Command imperative loop with `AgentEventEmitter` instead of RxJS expand recursion.
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
