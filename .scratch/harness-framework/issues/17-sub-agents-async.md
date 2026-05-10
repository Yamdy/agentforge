Status: ready-for-agent

## Parent

`.scratch/harness-framework/PRD.md`

## What to build

Implement async sub-agents with concurrency control, model fallback chains, and EventBus-driven lifecycle.

**Async task config:**
```typescript
interface AsyncTaskConfig extends SubAgentConfig {
  concurrencySlot?: ConcurrencySlot;  // { key: string, maxConcurrent: number }
  fallbackModels?: FallbackEntry[];   // ordered model fallback chain
}
```

**Async task handle:**
```typescript
interface AsyncTaskHandle {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: SubAgentResult;
  error?: Error;
  cancel(): void;
  on_complete(handler: (result: SubAgentResult) => void): void;
}
```

**TaskManager:**
```typescript
interface TaskManager {
  launch(config: AsyncTaskConfig, prompt: string): Promise<AsyncTaskHandle>;
  get(taskId: string): AsyncTaskHandle | undefined;
  cancel(taskId: string): void;
  list(filter?: { parentSessionId?: string }): AsyncTaskHandle[];
}
```

**Key behaviors:**
- `ConcurrencyController` enforces per-slot limits (e.g., max 3 tasks per model)
- Model fallback chain tries next model on failure
- EventBus `task:start` / `task:end` / `task:error` events for lifecycle tracking
- Parent agent notified on completion via `on_complete` callback or EventBus subscription

## Acceptance criteria

- [ ] Main agent submits async task and receives task ID immediately
- [ ] Async sub-agent runs independently with isolated context
- [ ] ConcurrencyController limits parallel tasks per slot
- [ ] Model fallback chain tries next model on failure
- [ ] `task:end` event emitted with result on completion
- [ ] `cancel()` stops a running sub-agent
- [ ] `list()` returns tasks filtered by parent session
- [ ] Test: submit async task, parent continues, receives completion event

## Blocked by

- Issue 10 (Sub-agents Sync)
- Plan A (Foundation — EventBus, ConcurrencyController)

## User stories covered

28
