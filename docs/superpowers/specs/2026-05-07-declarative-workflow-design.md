# Declarative Workflow — Design Spec

**Date**: 2026-05-07
**Status**: Approved
**References**: Mastra Workflow Builder, CrewAI Flow Decorators

## 1. Overview

Extend AgentForge's existing `Workflow` from linear `WorkflowStep[]` to a recursive `StepFlowEntry[]` union type supporting four flow control primitives: sequential step, conditional branch, parallel execution, and iteration.

### Design Decisions (all aggressive — no backward compat shims)

| Decision | Choice |
|----------|--------|
| Type migration | `WorkflowConfig.steps` changed from `WorkflowStep[]` to `StepFlowEntry[]` directly |
| Zod schemas | `z.lazy()` + `z.discriminatedUnion('type', [...])` |
| Checkpoint paths | Recursive `PathSegment[]` in V1, not deferred |

## 2. Core Types

### 2.1 StepFlowEntry

```typescript
type PathSegment = number | 'then' | 'else';

interface StepEntry {
  type: 'step';
  id: string;
  name?: string;
  prompt: (input: unknown) => string;
  timeout?: number;
  skip?: (input: unknown) => boolean;
  retryCount?: number;
}

interface BranchEntry {
  type: 'branch';
  id: string;
  condition: (input: unknown) => boolean;
  then: StepFlowEntry[];
  else?: StepFlowEntry[];
}

interface ParallelEntry {
  type: 'parallel';
  id: string;
  branches: StepFlowEntry[][];
  maxConcurrency?: number;
}

interface ForEachEntry {
  type: 'foreach';
  id: string;
  items: (input: unknown) => unknown[];
  body: StepFlowEntry[];
  maxConcurrency?: number;
}

type StepFlowEntry = StepEntry | BranchEntry | ParallelEntry | ForEachEntry;
```

### 2.2 Zod Schemas

```typescript
const StepEntrySchema = z.object({
  type: z.literal('step'),
  id: z.string(),
  name: z.string().optional(),
  prompt: z.function().args(z.unknown()).returns(z.string()),
  timeout: z.number().positive().optional(),
  skip: z.function().args(z.unknown()).returns(z.boolean()).optional(),
  retryCount: z.number().int().nonnegative().optional(),
});

const StepFlowEntrySchema: z.ZodType<StepFlowEntry> = z.lazy(() =>
  z.discriminatedUnion('type', [
    StepEntrySchema,
    z.object({
      type: z.literal('branch'),
      id: z.string(),
      condition: z.function().args(z.unknown()).returns(z.boolean()),
      then: z.array(StepFlowEntrySchema),
      else: z.array(StepFlowEntrySchema).optional(),
    }),
    z.object({
      type: z.literal('parallel'),
      id: z.string(),
      branches: z.array(z.array(StepFlowEntrySchema)),
      maxConcurrency: z.number().int().positive().optional(),
    }),
    z.object({
      type: z.literal('foreach'),
      id: z.string(),
      items: z.function().args(z.unknown()).returns(z.array(z.unknown())),
      body: z.array(StepFlowEntrySchema),
      maxConcurrency: z.number().int().positive().optional(),
    }),
  ])
);

// WorkflowConfig.steps changed to:
const WorkflowConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(StepFlowEntrySchema).min(1),
  defaultTimeout: z.number().positive().optional(),
  continueOnFailure: z.boolean().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
});
```

`z.function()` fields (`prompt`, `condition`, `items`) are trusted Tier-3 — Zod validates they are callable but cannot inspect signatures at runtime. Recursive `z.lazy()` + `z.discriminatedUnion()` produces terse error messages. Each variant should include `.describe()` on key fields (e.g., `id: z.string().describe('StepFlowEntry id')`) so validation failures include a human-readable trail.

## 3. Builder API

```typescript
const config = workflow('research', { name: 'Research Workflow' })
  .then(fetchStep)
  .branch(
    (input) => input.quality > 0.8,
    (sub) => sub.then(polishStep),
    (sub) => sub.then(retryStep)
  )
  .parallel([
    (sub) => sub.then(summarizeStep),
    (sub) => sub.then(extractStep),
  ])
  .foreach(
    (input) => input.documents,
    (sub) => sub.then(reviewStep)
  )
  .commit();
```

```typescript
// Top-level builder — has .commit()
interface WorkflowBuilder {
  then(step: StepEntry): this;
  branch(condition: (input: unknown) => boolean, thenFlow: SubflowBuilder, elseFlow?: SubflowBuilder): this;
  parallel(branches: SubflowBuilder[]): this;
  foreach(items: (input: unknown) => unknown[], body: SubflowBuilder): this;
  commit(): WorkflowConfig;
}

// Sub-builder — same API, no .commit()
interface SubflowBuilder {
  then(step: StepEntry): this;
  branch(condition: (input: unknown) => boolean, thenFlow: SubflowBuilder, elseFlow?: SubflowBuilder): this;
  parallel(branches: SubflowBuilder[]): this;
  foreach(items: (input: unknown) => unknown[], body: SubflowBuilder): this;
  // No .commit() — sub-builders are compiled by the parent builder
}
```

- Nesting is unbounded — a `foreach` body can contain a `parallel` containing a `branch` containing another `foreach`
- Sub-builder methods mutate-and-return-self (the same builder instance)
- The `(sub) => sub.then(x).then(y)` pattern works because `.then()` returns `sub`

## 4. Executor Dispatch

`WorkflowExecutor` gains recursive `executeEntries()`. All user-supplied functions (`condition`, `items`) are wrapped in try/catch — a throwing function produces a failure result rather than crashing the workflow.

```typescript
interface ExecuteEntriesOptions {
  continueOnFailure: boolean;
}

async executeEntries(
  entries: StepFlowEntry[],
  input: unknown,
  workflowId: string,
  listener: (event) => void,
  path: PathSegment[] = [],
  options: ExecuteEntriesOptions = { continueOnFailure: false }
): Promise<{ output: unknown; error?: SerializedError }> {
  let currentInput = input;
  let firstError: SerializedError | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const entryPath = [...path, i];

    switch (entry.type) {
      case 'step': {
        const result = await this.executeStep(entry, currentInput, workflowId, listener);
        if (result.result === 'failure') {
          firstError = result.error;
          if (!options.continueOnFailure) return { output: currentInput, error: result.error };
        } else {
          currentInput = result.output ?? currentInput;
        }
        break;
      }

      case 'branch': {
        let direction: 'then' | 'else';
        try {
          direction = entry.condition(currentInput) ? 'then' : 'else';
        } catch (err) {
          firstError = serializeError(err);
          if (!options.continueOnFailure) return { output: currentInput, error: firstError };
          break; // skip branch on condition error when continueOnFailure
        }
        const subFlow = direction === 'then' ? entry.then : (entry.else ?? []);
        const subResult = await this.executeEntries(
          subFlow, currentInput, workflowId, listener,
          [...entryPath, direction], options
        );
        currentInput = subResult.output;
        if (subResult.error) {
          firstError = subResult.error;
          if (!options.continueOnFailure) return { output: currentInput as unknown, error: firstError };
        }
        break;
      }

      case 'parallel': {
        const results = await Promise.all(
          entry.branches.map((branch, bi) =>
            this.executeEntries(branch, currentInput, workflowId, listener,
              [...entryPath, bi], options)
          )
        );
        // Aggregate results; surface first error
        const merged: Record<string, unknown> = {};
        for (let bi = 0; bi < results.length; bi++) {
          const r = results[bi]!;
          if (r.error && !firstError) firstError = r.error;
          if (r.output !== undefined) merged[`branch_${bi}`] = r.output;
        }
        currentInput = merged;
        if (firstError && !options.continueOnFailure) {
          return { output: currentInput, error: firstError };
        }
        break;
      }

      case 'foreach': {
        let items: unknown[];
        try {
          items = entry.items(currentInput);
        } catch (err) {
          firstError = serializeError(err);
          if (!options.continueOnFailure) return { output: currentInput, error: firstError };
          break; // skip foreach on items error when continueOnFailure
        }
        const results = await Promise.all(
          items.map((item, idx) =>
            this.executeEntries(entry.body, item, workflowId, listener,
              [...entryPath, idx], options)
          )
        );
        currentInput = results.map(r => r.output);
        for (const r of results) {
          if (r.error && !firstError) firstError = r.error;
        }
        if (firstError && !options.continueOnFailure) {
          return { output: currentInput, error: firstError };
        }
        break;
      }
    }
  }

  return { output: currentInput, error: firstError };
}
```

Key behaviors:
- `continueOnFailure: false` (default): first error in any entry aborts the entire workflow
- `continueOnFailure: true`: errors are accumulated, execution continues through remaining entries
- `condition()` and `items()` are wrapped in try/catch — they produce failures rather than crashes
- Parallel branches: all branches execute, first error is surfaced, outputs are merged with `branch_N` keys
- ForEach: all items processed, first error surfaced, outputs are arrays

## 5. Checkpoint with Recursive Paths

### 5.1 WorkflowExecutionContext Changes

```typescript
interface WorkflowExecutionContext {
  // ... existing fields ...
  currentPath: PathSegment[];          // replaces currentStepIndex
  completedBranches: Set<string>;      // parallel/fork completion tracking
}
```

`completedBranches` stores serialized path strings (e.g., `"0.then.1"`) of completed sub-flow segments. On resume, the runner replays the tree and skips branches whose path prefix is in this set.

### 5.2 Serialization

```typescript
function serializeContext(): Record<string, unknown> {
  return {
    // ... existing fields ...
    currentPath: ctx?.currentPath ?? [],
    completedBranches: ctx?.completedBranches ? [...ctx.completedBranches] : [],
    stepOutputs: ctx?.stepOutputs ? Object.fromEntries(ctx.stepOutputs) : {},
  };
}
```

### 5.3 Resume Algorithm

Workflow.run() reads `currentPath` and `completedBranches` from the snapshot. The resume algorithm:

1. Walk `flow` entries by `currentPath` segments to find the resume point
2. For each `branch` entry in the path: the direction segment ('then'/'else') tells which sub-flow was in progress — skip the completed portion
3. For each `parallel` entry in the path: the numeric segment tells which branch was in progress. Paths of already-completed sibling branches are in `completedBranches` — skip them. The remaining branch resumes at its entry index
4. For each `foreach` entry: the numeric segment tells which item index was in progress. Earlier items are in `completedBranches` and skipped. The remaining item resumes

Example: `currentPath = [3, 2, 0]` means "entry 3 (foreach), item 2, body entry 0". Items 0 and 1 completed, item 2 resumes at body entry 0.

### 5.4 Suspend

Suspend stores current path at the next *entry boundary* and persists `completedBranches`. A parallel block with 3 branches where branch 1 is in progress stores the path `[parallelEntryIndex, 1, ...]` and marks branches 0 as completed. On resume, branch 1 continues from its checkpoint and branch 2 runs normally after.

## 6. Migration Impact

### 6.1 Type replacements

| Old | New | Notes |
|-----|-----|-------|
| `WorkflowStepSchema` | `StepEntrySchema` | Keep `WorkflowStepSchema` as deprecated re-export |
| `WorkflowStep` | `StepEntry` | Keep `WorkflowStep` as deprecated type alias |
| `WorkflowStepWithAgent` | Extends `StepEntry` | Add `agentContext?: AgentContext` |
| `WorkflowConfig.steps: WorkflowStep[]` | `WorkflowConfig.steps: StepFlowEntry[]` | Breaking |
| `currentStepIndex: number` | `currentPath: PathSegment[]` | Breaking |

### 6.2 Files to modify

**Core workflow:**
- `src/workflow/types.ts` — new types, new Zod schemas, updated WorkflowConfigSchema
- `src/workflow/executor.ts` — add `executeEntries()` with recursive dispatch
- `src/workflow/workflow.ts` — run() calls executeEntries, checkpoint uses PathSegment[] + completedBranches
- `src/workflow/builder.ts` — **new file**: WorkflowBuilder + SubflowBuilder
- `src/workflow/index.ts` — export new types, builder, factory function

**Downstream consumers:**
- `src/workflow/pipeline.ts` — `SequentialPipeline`/`ParallelPipeline` only need `type: 'step'` addition on `WorkflowStep` construction (they remain flat, no recursive dispatch)
- `src/workflow/agent-step.ts` — `createStepFromAgent()`/`createWorkflowFromAgents()` add `type: 'step' as const`
- `src/integration/mpu-config.ts` — any `WorkflowStep` literal references need `type: 'step'`
- `src/l1/` — JSON workflow config files need `"type": "step"` on each step object

**Tests:**
- `tests/workflow/workflow.spec.ts` — all `WorkflowStep` → add `type: 'step' as const` (mechanical)
- `tests/workflow/pipeline.spec.ts` — same mechanical change
- `tests/workflow/` — **new files**: branch/parallel/foreach/checkpoint-resume tests

### Mechanical changes
- Every place that constructs a step literal `{ id, name?, prompt, ... }` → add `type: 'step' as const`
- Every `.steps[i]` access → narrow on `entry.type` (TypeScript exhaustiveness check)
- L1 JSON workflow configs: add `"type": "step"` to each object in `steps` arrays

## 7. V1 Scope

| Feature | Included |
|---------|----------|
| `then` (sequential step) | Yes |
| `branch` (2-way conditional) | Yes |
| `parallel` (concurrent) | Yes |
| `foreach` (iteration) | Yes |
| Builder API | Yes |
| Zod schemas for all new types | Yes |
| Recursive checkpoint paths | Yes |
| `dowhile`/`dountil` | No (simulate with foreach+branch) |
| `sleep`/`sleepUntil` | No (trivial, add later if needed) |
| Decorator syntax (`@start/@listen/@router`) | No (V2, sugar on top of Builder) |
| `skip` on non-step entries | No (wrap in branch) |
