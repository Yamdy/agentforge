# Eliminate Agent Loop Control Duplication

## Context

`Agent.run()` and `Agent.stream()` each independently implement the same loop control: phase orchestration (pre-loop → loop → post-loop), iteration counting, loopDirective reset/check, and context threading. Any new loop feature must be added in two places.

Three bugs exist:
1. **retryFrom lost in run()**: `loopDirective` is reset to `undefined` at line 69 BEFORE reading it at line 72. When an AbortSignal with retryFrom triggers `continue` (line 81), the next iteration resets loopDirective (line 69), discarding the retryFrom. The existing TripWire test passes because it uses `retryFrom: 'prepareStep'` (index 0 of LOOP_STAGES), so losing retryFrom has no visible effect — all stages run from the start, which includes prepareStep.
2. **stream() ignores abort**: `runner.stream()` yields `{ type: 'abort' }` but `stream()` never checks for it — aborts are silently swallowed.
3. **StreamEvent.abort missing retryFrom**: SDK type's abort variant is `{ type: 'abort'; reason: string }` with no `retryFrom`, so `PipelineRunner.stream()` discards `AbortSignal.retryFrom`.

## Approach (Revised per Oracle Review)

**Do NOT switch `run()` to use `runner.stream()` internally.** The `createMemoryOutputProcessor` (memory-processor.ts:56) reads `ctx.iteration.response` at the `processOutput` stage. `runner.run()` sets `response` via `consumeTextStream()`, but `runner.stream()` does not. Switching would break any `processOutput` processor that reads the response.

Instead:
1. Fix bugs individually in both methods (5 tracer bullets)
2. Refactor: extract shared helper (`computeLoopStages()`) for the retryFrom calculation
3. Keep `run()` using `runner.run()` and `stream()` using `runner.stream()`
4. Document the remaining phase orchestration duplication (~5 lines) as acceptable for two consumers

**Note on `stream()` abort**: Changing from silent ignore to throw is a behavioral change. Current behavior is a bug — silently swallowing guardrail aborts is wrong. Consumers should handle errors from `stream()`.

## Files

- `packages/sdk/src/index.ts` — StreamEvent type: add `retryFrom` to abort variant
- `packages/core/src/pipeline.ts` — PipelineRunner.stream(): include retryFrom in abort yield
- `packages/core/src/agent.ts` — Fix retryFrom bug, add stream() abort/retry handling, extract helper
- `packages/sdk/__tests__/exports.test.ts` — Cover abort with retryFrom
- `packages/core/__tests__/full-pipeline.test.ts` — Test retryFrom from invokeLLM (exposes bug)
- `packages/core/__tests__/streaming.test.ts` — Test stream abort, stream retry
- `packages/core/__tests__/pipeline-streaming.test.ts` — Test PipelineRunner.stream() abort with retryFrom

## Tracer Bullets (RED → GREEN → commit)

### Bullet 1: Fix retryFrom bug in run()

**RED** — `full-pipeline.test.ts`: Add test with `retryFrom: 'invokeLLM'` (index 2 of LOOP_STAGES, not index 0). Since retryFrom is lost, prepareStep incorrectly re-runs on retry. Test asserts prepareStep runs once, invokeLLM runs twice. This test FAILS on current code.

**GREEN** — `agent.ts`: Read `loopDirective` BEFORE resetting:
```typescript
// Before (lines 69-74):
ctx = { ...ctx, iteration: { ...ctx.iteration, step: i, loopDirective: undefined } };
const loopDirective = ctx.iteration.loopDirective; // always undefined!
const retryFrom = loopDirective?.action === 'retry' ? loopDirective.retryFrom : undefined;

// After:
const prevDirective = ctx.iteration.loopDirective;
ctx = { ...ctx, iteration: { ...ctx.iteration, step: i, loopDirective: undefined } };
const retryFrom = prevDirective?.action === 'retry' ? prevDirective.retryFrom : undefined;
```

### Bullet 2: Add retryFrom to StreamEvent type + PipelineRunner.stream() + tests

This is one tracer bullet that covers the full vertical slice: SDK type → pipeline impl → tests.

**RED** — `exports.test.ts`: Add test creating `{ type: 'abort', reason: 'policy', retryFrom: 'invokeLLM' }`. Won't compile — StreamEvent abort variant has no `retryFrom`.

Also update "represents all event types" test to include the new abort variant (8 events instead of 7):
```typescript
{ type: 'abort', reason: 'retry', retryFrom: 'invokeLLM' },
```

**RED** — `pipeline-streaming.test.ts`: Add test that abort event from `runner.stream()` includes `retryFrom: 'invokeLLM'`. Currently only has `reason`.

**GREEN** — Two changes:
1. `sdk/src/index.ts` line 203:
```typescript
// Before:
| { type: 'abort'; reason: string };
// After:
| { type: 'abort'; reason: string; retryFrom?: PipelineStage };
```

2. `pipeline.ts` line 71:
```typescript
// Before:
yield { type: 'abort', reason: stageResult.reason };
// After:
yield { type: 'abort', reason: stageResult.reason, ...(stageResult.retryFrom ? { retryFrom: stageResult.retryFrom } : {}) };
```

### Bullet 3: Handle abort in stream()

**RED** — `streaming.test.ts`: Test that `agent.stream()` throws on abort from a processor. Currently stream() silently ignores abort events.

**GREEN** — `agent.ts` stream(): Add abort check in all three for-await loops:
```typescript
if (event.type === 'abort') {
  throw new Error(`Agent aborted: ${(event as { reason: string }).reason}`);
}
```

Apply to pre-loop, loop, and post-loop for-await blocks.

### Bullet 4: Add retryFrom support to stream()

**RED** — `streaming.test.ts`: Test that `agent.stream()` retries from the specified stage (`retryFrom: 'invokeLLM'`). Assert prepareStep runs once, invokeLLM runs twice.

**GREEN** — `agent.ts` stream():
1. Read loopDirective before resetting (same fix as Bullet 1)
2. Handle abort with retryFrom: set loopDirective on ctx, break inner for-await, continue outer loop
3. Use `stages` variable for retryFrom stage slicing (same as run())

The stream() loop body becomes:
```typescript
for (let i = 0; i < maxIter; i++) {
  const prevDirective = ctx.iteration.loopDirective;
  ctx = { ...ctx, iteration: { ...ctx.iteration, step: i, loopDirective: undefined } };
  const retryFrom = prevDirective?.action === 'retry' ? prevDirective.retryFrom : undefined;
  const stages = retryFrom ? LOOP_STAGES.slice(LOOP_STAGES.indexOf(retryFrom)) : LOOP_STAGES;

  let loopBreak = false;
  for await (const event of this.runner.stream(ctx, stages)) {
    if (event.type === 'text_delta') yield event.text;
    if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
    if (event.type === 'abort') {
      const abortEvent = event as { type: 'abort'; reason: string; retryFrom?: PipelineStage };
      if (abortEvent.retryFrom) {
        ctx = { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'retry', retryFrom: abortEvent.retryFrom } } };
        loopBreak = true;
        break;
      }
      throw new Error(`Agent aborted: ${abortEvent.reason}`);
    }
  }
  if (loopBreak) continue;
  if (ctx.iteration.loopDirective?.action === 'stop') break;
}
```

## Refactor (all tests GREEN → refactor → tests still GREEN)

### Refactor: Extract `computeLoopStages()` helper

Both methods now share the same retryFrom calculation. Extract to eliminate this duplication:

```typescript
private computeLoopStages(ctx: PipelineContext, step: number): { ctx: PipelineContext; stages: PipelineStage[] } {
  const prevDirective = ctx.iteration.loopDirective;
  const newCtx = { ...ctx, iteration: { ...ctx.iteration, step, loopDirective: undefined } };
  const retryFrom = prevDirective?.action === 'retry' ? prevDirective.retryFrom : undefined;
  const stages = retryFrom ? LOOP_STAGES.slice(LOOP_STAGES.indexOf(retryFrom)) : LOOP_STAGES;
  return { ctx: newCtx, stages };
}
```

Both `run()` and `stream()` call `const { ctx, stages } = this.computeLoopStages(ctx, i);` at the start of each loop iteration. Run full test suite after refactor to confirm no regressions.

## Acceptable Remaining Duplication

Phase orchestration (pre-loop → loop → post-loop, ~5 lines each) remains duplicated because the two methods use fundamentally different execution modes (`runner.run()` vs `runner.stream()`). This is acceptable for two call sites. A future 3rd execution mode would justify a template extraction.

## Verification

```bash
npx vitest run packages/sdk packages/core
```

All existing tests + new tests must pass. Key regression tests:
- `agent.test.ts`: basic run, maxIterations
- `streaming.test.ts`: streaming chunks, run/stream consistency
- `full-pipeline.test.ts`: stage order, TripWire abort, TripWire retry
- `agent-tool-loop.test.ts`: tool calling, parallel tools
