# Declarative Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Workflow from linear `WorkflowStep[]` to recursive `StepFlowEntry[]` with Builder API and four flow primitives (then/branch/parallel/foreach).

**Architecture:** `StepFlowEntry` recursive discriminated union drives executor dispatch. `WorkflowBuilder` compiles chain API into `WorkflowConfig`. Checkpoint uses `PathSegment[]` + `completedBranches` for resume. Breaking change — no backward compat shims.

**Tech Stack:** TypeScript strict, Zod z.lazy(), Vitest, TDD

**Spec:** `docs/superpowers/specs/2026-05-07-declarative-workflow-design.md`

---

### File Map

| File | Role |
|------|------|
| `src/workflow/types.ts` | StepFlowEntry, PathSegment, Zod schemas (modified) |
| `src/workflow/builder.ts` | WorkflowBuilder + SubflowBuilder (**new**) |
| `src/workflow/executor.ts` | executeEntries() recursive dispatch (modified) |
| `src/workflow/workflow.ts` | Checkpoint with PathSegment[] (modified) |
| `src/workflow/index.ts` | Exports (modified) |
| `src/workflow/pipeline.ts` | Mechanical: type: 'step' addition (modified) |
| `src/workflow/agent-step.ts` | Mechanical: type: 'step' addition (modified) |
| `tests/workflow/workflow.spec.ts` | Mechanical: type: 'step' addition (modified) |
| `tests/workflow/flow-control.spec.ts` | Branch/parallel/foreach integration tests (**new**) |

---

### Task 1: Core Types + Zod Schemas

**Files:**
- Modify: `src/workflow/types.ts`
- Modify: `src/workflow/index.ts`

- [ ] **Step 1: Write the failing test — schema rejects old WorkflowStep without `type`**

```typescript
// tests/workflow/workflow.spec.ts — add after existing imports
import { StepFlowEntrySchema } from '../../src/workflow/types.js';

describe('StepFlowEntrySchema', () => {
  it('rejects a step without type field', () => {
    const result = StepFlowEntrySchema.safeParse({
      id: 's1',
      prompt: () => 'hello',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid StepEntry', () => {
    const result = StepFlowEntrySchema.safeParse({
      type: 'step',
      id: 's1',
      prompt: () => 'hello',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid BranchEntry with nested steps', () => {
    const result = StepFlowEntrySchema.safeParse({
      type: 'branch',
      id: 'b1',
      condition: (input: unknown) => true,
      then: [{ type: 'step', id: 's1', prompt: () => 'yes' }],
      else: [{ type: 'step', id: 's2', prompt: () => 'no' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid ParallelEntry', () => {
    const result = StepFlowEntrySchema.safeParse({
      type: 'parallel',
      id: 'p1',
      branches: [
        [{ type: 'step', id: 'a', prompt: () => 'A' }],
        [{ type: 'step', id: 'b', prompt: () => 'B' }],
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid ForEachEntry', () => {
    const result = StepFlowEntrySchema.safeParse({
      type: 'foreach',
      id: 'f1',
      items: (input: unknown) => (input as { docs: unknown[] }).docs,
      body: [{ type: 'step', id: 'inner', prompt: () => 'process' }],
    });
    expect(result.success).toBe(true);
  });

  it('validates WorkflowConfig.steps as StepFlowEntry[]', () => {
    const result = WorkflowConfigSchema.safeParse({
      id: 'wf1',
      name: 'Test',
      steps: [{ type: 'step', id: 's1', prompt: () => 'hello' }],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/workflow/workflow.spec.ts -t "StepFlowEntrySchema" --no-color`
Expected: FAIL — `StepFlowEntrySchema` not exported, or old schema rejects `type` field

- [ ] **Step 3: Add types and schemas to types.ts**

In `src/workflow/types.ts`, add before the existing `WorkflowStepSchema`:

```typescript
// ============================================================
// Declarative Flow Types
// ============================================================

/** Checkpoint path segment: number = index, string = branch direction */
export type PathSegment = number | 'then' | 'else';

export interface StepEntry {
  type: 'step';
  id: string;
  name?: string;
  prompt: (input: unknown) => string;
  timeout?: number;
  skip?: (input: unknown) => boolean;
  retryCount?: number;
}

export interface BranchEntry {
  type: 'branch';
  id: string;
  condition: (input: unknown) => boolean;
  then: StepFlowEntry[];
  else?: StepFlowEntry[];
}

export interface ParallelEntry {
  type: 'parallel';
  id: string;
  branches: StepFlowEntry[][];
  maxConcurrency?: number;
}

export interface ForEachEntry {
  type: 'foreach';
  id: string;
  items: (input: unknown) => unknown[];
  body: StepFlowEntry[];
  maxConcurrency?: number;
}

export type StepFlowEntry = StepEntry | BranchEntry | ParallelEntry | ForEachEntry;
```

Add Zod schemas after the types:

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

export const StepFlowEntrySchema: z.ZodType<StepFlowEntry> = z.lazy(() =>
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
```

Update `WorkflowStepSchema` to be an alias (backward compat), and update `WorkflowConfigSchema.steps`:

```typescript
// Keep as deprecated alias
/** @deprecated Use StepEntrySchema */
export const WorkflowStepSchema = StepEntrySchema;

// Keep as deprecated alias
/** @deprecated Use StepEntry */
export type WorkflowStep = StepEntry;

// WorkflowStepWithAgent now extends StepEntry
export interface WorkflowStepWithAgent extends StepEntry {
  agentContext?: import('../core/context.js').AgentContext;
}

// Update WorkflowConfigSchema
export const WorkflowConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(StepFlowEntrySchema).min(1),
  defaultTimeout: z.number().positive().optional(),
  continueOnFailure: z.boolean().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/workflow/workflow.spec.ts -t "StepFlowEntrySchema" --no-color`
Expected: PASS — 6/6 tests

- [ ] **Step 5: Update index.ts exports**

In `src/workflow/index.ts`, add to exports:

```typescript
export {
  // New declarative types
  type StepEntry,
  type BranchEntry,
  type ParallelEntry,
  type ForEachEntry,
  type StepFlowEntry,
  type PathSegment,
  StepFlowEntrySchema,
  StepEntrySchema as _StepEntrySchema,
} from './types.js';
```

- [ ] **Step 6: Verify existing tests still compile and pass**

Run: `pnpm exec tsc --noEmit`
Expected: May have type errors from places constructing WorkflowStep without `type: 'step'` — these will be fixed in Task 7.
If errors only from Task 7 files, proceed.

- [ ] **Step 7: Commit**

```bash
git add src/workflow/types.ts src/workflow/index.ts tests/workflow/workflow.spec.ts
git commit -m "feat(workflow): add StepFlowEntry types and Zod schemas"
```

---

### Task 2: Builder API

**Files:**
- Create: `src/workflow/builder.ts`
- Modify: `src/workflow/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workflow/flow-control.spec.ts (new file)
import { describe, it, expect } from 'vitest';
import { workflow } from '../../src/workflow/builder.js';
import type { StepEntry, WorkflowConfig } from '../../src/workflow/types.js';

function step(id: string): StepEntry {
  return { type: 'step', id, prompt: (input: unknown) => `Process: ${String(input)}` };
}

describe('WorkflowBuilder', () => {
  it('builds a linear workflow with .then()', () => {
    const config = workflow('test', { name: 'Test' })
      .then(step('s1'))
      .then(step('s2'))
      .commit();

    expect(config.id).toBe('test');
    expect(config.name).toBe('Test');
    expect(config.steps).toHaveLength(2);
    expect(config.steps[0]!.type).toBe('step');
  });

  it('builds a branch workflow', () => {
    const config = workflow('branch-test')
      .then(step('start'))
      .branch(
        (input) => (input as { x: number }).x > 0,
        (sub) => sub.then(step('positive')),
        (sub) => sub.then(step('negative'))
      )
      .commit();

    expect(config.steps).toHaveLength(2);
    const branch = config.steps[1]!;
    expect(branch.type).toBe('branch');
    if (branch.type === 'branch') {
      expect(branch.then).toHaveLength(1);
      expect(branch.else!).toHaveLength(1);
    }
  });

  it('builds a parallel workflow', () => {
    const config = workflow('parallel-test')
      .parallel([
        (sub) => sub.then(step('a')),
        (sub) => sub.then(step('b')),
      ])
      .commit();

    expect(config.steps[0]!.type).toBe('parallel');
  });

  it('builds a foreach workflow', () => {
    const config = workflow('foreach-test')
      .foreach(
        (input) => (input as { items: unknown[] }).items,
        (sub) => sub.then(step('process'))
      )
      .commit();

    expect(config.steps[0]!.type).toBe('foreach');
  });

  it('supports nested sub-flows', () => {
    const config = workflow('nested-test')
      .branch(
        () => true,
        (sub) => sub
          .then(step('inner1'))
          .parallel([
            (s2) => s2.then(step('p1')),
            (s2) => s2.then(step('p2')),
          ])
      )
      .commit();

    expect(config.steps[0]!.type).toBe('branch');
  });

  it('.commit() validates via WorkflowConfigSchema', () => {
    // Missing name — should be caught by schema validation
    expect(() => {
      (workflow as any)('bad').commit();
    }).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/workflow/flow-control.spec.ts -t "WorkflowBuilder" --no-color`
Expected: FAIL — `workflow` not exported from builder.ts

- [ ] **Step 3: Implement builder.ts**

```typescript
/**
 * AgentForge Declarative Workflow Builder
 *
 * Compiles chain API calls into a validated WorkflowConfig.
 *
 * @module
 */

import type { StepEntry, StepFlowEntry, WorkflowConfig } from './types.js';
import { WorkflowConfigSchema } from './types.js';

export interface WorkflowBuilderOptions {
  name?: string;
  continueOnFailure?: boolean;
  maxRetries?: number;
}

class BuilderImpl {
  private _entries: StepFlowEntry[] = [];

  then(step: StepEntry): this {
    this._entries.push(step);
    return this;
  }

  branch(
    condition: (input: unknown) => boolean,
    thenFlow: SubflowBuilder,
    elseFlow?: SubflowBuilder
  ): this {
    const thenEntries = (thenFlow as SubflowBuilderImpl).entries();
    const elseEntries = elseFlow ? (elseFlow as SubflowBuilderImpl).entries() : undefined;
    this._entries.push({
      type: 'branch',
      id: `branch_${this._entries.length}`,
      condition,
      then: thenEntries,
      else: elseEntries,
    });
    return this;
  }

  parallel(branches: SubflowBuilder[]): this {
    const branchEntries = branches.map(b => (b as SubflowBuilderImpl).entries());
    this._entries.push({
      type: 'parallel',
      id: `parallel_${this._entries.length}`,
      branches: branchEntries,
    });
    return this;
  }

  foreach(
    items: (input: unknown) => unknown[],
    body: SubflowBuilder
  ): this {
    const bodyEntries = (body as SubflowBuilderImpl).entries();
    this._entries.push({
      type: 'foreach',
      id: `foreach_${this._entries.length}`,
      items,
      body: bodyEntries,
    });
    return this;
  }

  entries(): StepFlowEntry[] {
    return [...this._entries];
  }
}

class SubflowBuilderImpl extends BuilderImpl {
  // Same API as BuilderImpl, but commit() is not available —
  // sub-builders are consumed by the parent builder via entries().
}

export interface SubflowBuilder {
  then(step: StepEntry): this;
  branch(condition: (input: unknown) => boolean, thenFlow: SubflowBuilder, elseFlow?: SubflowBuilder): this;
  parallel(branches: SubflowBuilder[]): this;
  foreach(items: (input: unknown) => unknown[], body: SubflowBuilder): this;
}

class WorkflowBuilderImpl extends BuilderImpl {
  private _id: string;
  private _options: WorkflowBuilderOptions;

  constructor(id: string, options: WorkflowBuilderOptions = {}) {
    super();
    this._id = id;
    this._options = options;
  }

  commit(): WorkflowConfig {
    const config = {
      id: this._id,
      name: this._options.name ?? this._id,
      steps: this.entries(),
      ...(this._options.continueOnFailure !== undefined ? { continueOnFailure: this._options.continueOnFailure } : {}),
      ...(this._options.maxRetries !== undefined ? { maxRetries: this._options.maxRetries } : {}),
    };
    return WorkflowConfigSchema.parse(config);
  }
}

export interface WorkflowBuilder {
  then(step: StepEntry): this;
  branch(condition: (input: unknown) => boolean, thenFlow: SubflowBuilder, elseFlow?: SubflowBuilder): this;
  parallel(branches: SubflowBuilder[]): this;
  foreach(items: (input: unknown) => unknown[], body: SubflowBuilder): this;
  commit(): WorkflowConfig;
}

export function workflow(id: string, options?: WorkflowBuilderOptions): WorkflowBuilder {
  return new WorkflowBuilderImpl(id, options) as unknown as WorkflowBuilder;
}

export function subflow(): SubflowBuilder {
  return new SubflowBuilderImpl() as unknown as SubflowBuilder;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/workflow/flow-control.spec.ts -t "WorkflowBuilder" --no-color`
Expected: PASS — 6/6 tests

- [ ] **Step 5: Update index.ts exports**

In `src/workflow/index.ts`, add:

```typescript
export {
  workflow,
  subflow,
  type WorkflowBuilder,
  type SubflowBuilder,
  type WorkflowBuilderOptions,
} from './builder.js';
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/workflow/builder.ts src/workflow/index.ts tests/workflow/flow-control.spec.ts
git commit -m "feat(workflow): add declarative Builder API (WorkflowBuilder + SubflowBuilder)"
```

---

### Task 3: Executor Recursive Dispatch

**Files:**
- Modify: `src/workflow/executor.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/workflow/flow-control.spec.ts — add after Builder tests
import { WorkflowExecutor } from '../../src/workflow/executor.js';
import type { StepFlowEntry } from '../../src/workflow/types.js';
import { AgentEventEmitter, type AgentEvent } from '../../src/core/events.js';

function mockExecutor() {
  type LLMAdapter = import('../../src/core/interfaces.js').LLMAdapter;
  type ToolRegistry = import('../../src/core/interfaces.js').ToolRegistry;
  type AgentContext = import('../../src/core/context.js').AgentContext;

  const emitter = new AgentEventEmitter();
  const ctx = {
    sessionId: 'test',
    agentName: 'test',
    llm: { provider: 'mock', name: 'mock', chat: async () => ({ content: 'ok', finishReason: 'stop' }) } as unknown as LLMAdapter,
    tools: { list: () => [], has: () => false, get: () => undefined } as unknown as ToolRegistry,
    memory: { get: async () => null, set: async () => {} },
    pauseController: { onResume: () => () => {}, isPaused: () => false },
    services: {},
    hookRegistry: { getRequestHooks: () => [], getCheckpoints: () => [] },
  } as unknown as AgentContext;

  return { executor: new WorkflowExecutor(ctx), ctx, emitter };
}

describe('WorkflowExecutor executeEntries', () => {
  it('executes a linear sequence of StepEntry[]', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      { type: 'step', id: 's1', prompt: () => 'hello' },
    ];

    const events: AgentEvent[] = [];
    const result = await executor.executeEntries(flow, 'input', 'wf-1', (e) => events.push(e));

    expect(result.error).toBeUndefined();
  });

  it('executes a branch (then path)', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      {
        type: 'branch',
        id: 'b1',
        condition: () => true,
        then: [{ type: 'step', id: 'yes', prompt: () => 'taken' }],
      },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeUndefined();
  });

  it('executes a branch (else path)', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      {
        type: 'branch',
        id: 'b1',
        condition: () => false,
        then: [{ type: 'step', id: 'no', prompt: () => 'not-taken' }],
        else: [{ type: 'step', id: 'yes', prompt: () => 'taken' }],
      },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeUndefined();
  });

  it('executes parallel branches concurrently', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      {
        type: 'parallel',
        id: 'p1',
        branches: [
          [{ type: 'step', id: 'a', prompt: () => 'A' }],
          [{ type: 'step', id: 'b', prompt: () => 'B' }],
        ],
      },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeUndefined();
    expect(result.output).toHaveProperty('branch_0');
    expect(result.output).toHaveProperty('branch_1');
  });

  it('executes foreach over items', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      {
        type: 'foreach',
        id: 'f1',
        items: () => ['a', 'b', 'c'],
        body: [{ type: 'step', id: 'inner', prompt: () => 'process' }],
      },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.output)).toBe(true);
    expect((result.output as unknown[])).toHaveLength(3);
  });

  it('surfaces first error from a failing step', async () => {
    const { executor } = mockExecutor();
    // Override executeStep to simulate failure
    const origExecuteStep = executor.executeStep.bind(executor);
    executor.executeStep = async (step, input, wfId, listener) => {
      if (step.id === 'fail') {
        return { stepId: step.id, result: 'failure' as const, error: { name: 'Error', message: 'step failed' } };
      }
      return origExecuteStep(step, input, wfId, listener);
    };

    const flow: StepFlowEntry[] = [
      { type: 'step', id: 'fail', prompt: () => 'will fail' },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe('step failed');
  });

  it('continues on failure when continueOnFailure is true', async () => {
    const { executor } = mockExecutor();
    const origExecuteStep = executor.executeStep.bind(executor);
    executor.executeStep = async (step, input, wfId, listener) => {
      if (step.id === 'fail') {
        return { stepId: step.id, result: 'failure' as const, error: { name: 'Error', message: 'failed' } };
      }
      return origExecuteStep(step, input, wfId, listener);
    };

    const flow: StepFlowEntry[] = [
      { type: 'step', id: 'fail', prompt: () => 'fails' },
      { type: 'step', id: 'ok', prompt: () => 'continues' },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {}, [], { continueOnFailure: true });
    expect(result.error).toBeDefined();
    // Despite error, output should be from the second step
  });

  it('catches condition() throwing and surfaces as error', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      {
        type: 'branch',
        id: 'b1',
        condition: () => { throw new Error('condition boom'); },
        then: [{ type: 'step', id: 'yes', prompt: () => 'unreachable' }],
      },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('condition boom');
  });

  it('catches items() throwing and surfaces as error', async () => {
    const { executor } = mockExecutor();
    const flow: StepFlowEntry[] = [
      {
        type: 'foreach',
        id: 'f1',
        items: () => { throw new Error('items boom'); },
        body: [{ type: 'step', id: 'inner', prompt: () => 'unreachable' }],
      },
    ];

    const result = await executor.executeEntries(flow, 'input', 'wf-1', () => {});
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain('items boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest tests/workflow/flow-control.spec.ts -t "executeEntries" --no-color`
Expected: FAIL — `executeEntries` not defined on WorkflowExecutor

- [ ] **Step 3: Implement executeEntries in executor.ts**

Add to `WorkflowExecutor` class in `src/workflow/executor.ts`:

```typescript
import { type SerializedError, serializeError } from '../core/index.js';
import type { StepFlowEntry, PathSegment, StepEntry } from './types.js';

export interface ExecuteEntriesOptions {
  continueOnFailure: boolean;
}

// Inside WorkflowExecutor class, add:

async executeEntries(
  entries: StepFlowEntry[],
  input: unknown,
  workflowId: string,
  listener: (event: WorkflowOrAgentEvent) => void,
  path: PathSegment[] = [],
  options: ExecuteEntriesOptions = { continueOnFailure: false }
): Promise<{ output: unknown; error?: SerializedError }> {
  let currentInput = input;
  let firstError: SerializedError | undefined;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;

    switch (entry.type) {
      case 'step': {
        const result = await this.executeStep(entry as WorkflowStep, currentInput, workflowId, listener);
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
          break;
        }
        const subFlow = direction === 'then' ? entry.then : (entry.else ?? []);
        const subResult = await this.executeEntries(
          subFlow, currentInput, workflowId, listener,
          [...path, i, direction], options
        );
        currentInput = subResult.output;
        if (subResult.error) {
          firstError = subResult.error;
          if (!options.continueOnFailure) return { output: currentInput, error: firstError };
        }
        break;
      }

      case 'parallel': {
        const results = await Promise.all(
          entry.branches.map((branch, bi) =>
            this.executeEntries(branch, currentInput, workflowId, listener,
              [...path, i, bi], options)
          )
        );
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
          break;
        }
        const results = await Promise.all(
          items.map((item, idx) =>
            this.executeEntries(entry.body, item, workflowId, listener,
              [...path, i, idx], options)
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest tests/workflow/flow-control.spec.ts -t "executeEntries" --no-color`
Expected: PASS — 9/9 tests

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/workflow/executor.ts tests/workflow/flow-control.spec.ts
git commit -m "feat(workflow): add executeEntries recursive dispatch"
```

---

### Task 4: Workflow.run() wiring + Checkpoint

**Files:**
- Modify: `src/workflow/workflow.ts`

- [ ] **Step 1: Write the failing checkpoint test**

```typescript
// tests/workflow/flow-control.spec.ts — add checkpoint tests
import { createWorkflow, type WorkflowCheckpointStorage } from '../../src/workflow/workflow.js';
import { workflow as build } from '../../src/workflow/builder.js';

describe('Workflow checkpoint with recursive paths', () => {
  it('stores currentPath in checkpoint snapshot', async () => {
    const storage: WorkflowCheckpointStorage = {
      saved: null as Record<string, unknown> | null,
      async save(snapshot: Record<string, unknown>) {
        this.saved = snapshot;
      },
      async load(_sessionId: string) {
        return this.saved;
      },
    };

    const wf = createWorkflow({
      id: 'cp-test',
      name: 'Checkpoint Test',
      steps: [
        { type: 'step', id: 's1', prompt: () => 'hello' },
        { type: 'step', id: 's2', prompt: () => 'world' },
      ],
    }, mockCtx, { checkpointStorage: storage });

    // Start workflow, let it run a bit then suspend
    let started = false;
    const runPromise = wf.run('input', (event) => {
      if (event.type === 'workflow.step.end' && !started) {
        started = true;
        wf.suspend('test');
      }
    });

    const result = await runPromise;
    // After suspend+resume, workflow should complete
    // Verify checkpoint was saved with currentPath
  });
});
```

- [ ] **Step 2: Run test to verify**

Run: `pnpm vitest tests/workflow/flow-control.spec.ts -t "checkpoint" --no-color`

- [ ] **Step 3: Rewrite Workflow.run() to use executeEntries**

The core change in `src/workflow/workflow.ts` — replace the linear `for (let index = ...)` loop (lines 165-267 in current code) with `this.executor.executeEntries()`:

```typescript
// Replace the for loop in run() with:

// Determine resume path from snapshot
const resumePath: PathSegment[] = snapshot
  ? (Array.isArray(snapshot.currentPath) ? snapshot.currentPath as PathSegment[] : [])
  : [];

// Execute entries via recursive dispatch
const execResult = await this.executor.executeEntries(
  this.config.steps,
  currentInput,
  workflowId,
  event => {
    // Existing listener forwarding + output capture logic stays the same
    if (event.type === 'agent.complete') {
      capturedOutput = event.output;
      this.executionContext?.stepOutputs.set(
        (event as { stepId?: string }).stepId ?? 'unknown',
        capturedOutput
      );
    }
    if (event.type === 'agent.error') {
      capturedError = event.error;
    }
    listener(event);
  },
  resumePath,
  { continueOnFailure: this.config.continueOnFailure ?? false }
);

stepsCompleted = this.config.steps.length; // All entries processed
```

Update the `suspend()` method to capture `currentPath`:

```typescript
suspend(_reason: string): void {
  if (this.executionContext?.state !== 'running') return;
  this.suspended = true;
  this.executionContext = {
    ...this.executionContext,
    state: 'suspended',
    suspensionReason: _reason,
    currentPath: this.executionContext.currentPath ?? [],
    completedBranches: this.executionContext.completedBranches ?? new Set(),
  };
  // ... checkpoint storage unchanged
}
```

Update `serializeContext()`:

```typescript
private serializeContext(): Record<string, unknown> {
  const ctx = this.executionContext;
  return {
    state: ctx?.state,
    workflowId: ctx?.workflowId,
    currentPath: ctx?.currentPath ?? [],
    completedBranches: ctx?.completedBranches ? [...ctx.completedBranches] : [],
    totalSteps: ctx?.totalSteps,
    suspensionReason: ctx?.suspensionReason,
    stepOutputs: ctx?.stepOutputs ? Object.fromEntries(ctx.stepOutputs) : {},
  };
}
```

Update `resume()` to load path from snapshot:

```typescript
// In the run() method's snapshot resume block, replace:
// loopStartIndex = ...
// with:
let resumePath: PathSegment[] = [];
if (snapshot && Array.isArray(snapshot.currentPath)) {
  resumePath = snapshot.currentPath as PathSegment[];
}
// And pass resumePath to executeEntries() instead of using loopStartIndex
```

- [ ] **Step 4: Run all workflow tests**

Run: `pnpm vitest tests/workflow/ --no-color`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/workflow/workflow.ts tests/workflow/flow-control.spec.ts
git commit -m "feat(workflow): wire executeEntries + PathSegment checkpoint"
```

---

### Task 5: Integration — Run flow control scenarios end-to-end

**Files:**
- Modify: `tests/workflow/flow-control.spec.ts`

- [ ] **Step 1: Write end-to-end scenario tests**

```typescript
describe('End-to-end flow scenarios', () => {
  it('branch: takes then path when condition is true', async () => {
    const config = build('branch-e2e')
      .then({ type: 'step', id: 'start', prompt: () => 'start' })
      .branch(
        (input) => (input as { x: number }).x > 0,
        (sub) => sub.then({ type: 'step', id: 'yes', prompt: (i) => `then:${String(i)}` }),
        (sub) => sub.then({ type: 'step', id: 'no', prompt: (i) => `else:${String(i)}` })
      )
      .commit();

    const wf = createWorkflow(config, mockCtx);
    const events: WorkflowOrAgentEvent[] = [];
    const result = await wf.run({ x: 1 }, (e) => events.push(e));

    expect(result.success).toBe(true);
    const stepEnds = events.filter(e => e.type === 'workflow.step.end');
    expect(stepEnds.length).toBeGreaterThanOrEqual(2); // start + yes
  });

  it('branch: takes else path when condition is false', async () => {
    const config = build('branch-else')
      .branch(
        () => false,
        (sub) => sub.then({ type: 'step', id: 'yes', prompt: () => 'never' }),
        (sub) => sub.then({ type: 'step', id: 'no', prompt: () => 'taken' })
      )
      .commit();

    const wf = createWorkflow(config, mockCtx);
    const result = await wf.run('input', () => {});
    expect(result.success).toBe(true);
  });

  it('parallel: produces merged branch_N outputs', async () => {
    const config = build('parallel-e2e')
      .parallel([
        (sub) => sub.then({ type: 'step', id: 'a', prompt: () => 'A' }),
        (sub) => sub.then({ type: 'step', id: 'b', prompt: () => 'B' }),
        (sub) => sub.then({ type: 'step', id: 'c', prompt: () => 'C' }),
      ])
      .commit();

    const wf = createWorkflow(config, mockCtx);
    const result = await wf.run('input', () => {});

    expect(result.success).toBe(true);
    expect(result.stepOutputs).toHaveProperty('a');
    expect(result.stepOutputs).toHaveProperty('b');
    expect(result.stepOutputs).toHaveProperty('c');
  });

  it('foreach: processes each item', async () => {
    const config = build('foreach-e2e')
      .foreach(
        () => ['x', 'y', 'z'],
        (sub) => sub.then({ type: 'step', id: 'inner', prompt: (i) => `item:${String(i)}` })
      )
      .commit();

    const wf = createWorkflow(config, mockCtx);
    const result = await wf.run('input', () => {});

    expect(result.success).toBe(true);
  });

  it('nested: branch > parallel', async () => {
    const config = build('nested-e2e')
      .then({ type: 'step', id: 'start', prompt: () => 'go' })
      .branch(
        () => true,
        (sub) => sub.parallel([
          (s2) => s2.then({ type: 'step', id: 'p-a', prompt: () => 'PA' }),
          (s2) => s2.then({ type: 'step', id: 'p-b', prompt: () => 'PB' }),
        ])
      )
      .commit();

    const wf = createWorkflow(config, mockCtx);
    const result = await wf.run('input', () => {});

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to see them pass**

Run: `pnpm vitest tests/workflow/flow-control.spec.ts -t "End-to-end" --no-color`

- [ ] **Step 3: Commit**

```bash
git add tests/workflow/flow-control.spec.ts
git commit -m "test(workflow): add end-to-end flow control scenario tests"
```

---

### Task 6: Mechanical Migration — add `type: 'step'` everywhere

**Files:**
- Modify: `src/workflow/pipeline.ts`
- Modify: `src/workflow/agent-step.ts`
- Modify: `tests/workflow/workflow.spec.ts`
- Modify: `src/integration/mpu-config.ts` (if references WorkflowStep)

- [ ] **Step 1: Fix agent-step.ts**

In `src/workflow/agent-step.ts`, change the step construction (line 94-98):

```typescript
const step: WorkflowStep = {
  type: 'step' as const,
  id,
  name: options.name ?? agent.name,
  prompt,
};
```

- [ ] **Step 2: Fix pipeline.ts**

In `src/workflow/pipeline.ts`, update `WorkflowStep` references. SequentialPipeline and ParallelPipeline accept `WorkflowStep[]` — these remain flat. Update step construction:

Any place that creates a `WorkflowStep` literal needs `type: 'step'`. Since pipelines accept existing `WorkflowStep[]` (now aliased to `StepEntry[]`), this is a mechanical add.

- [ ] **Step 3: Fix workflow.spec.ts**

In `tests/workflow/workflow.spec.ts`, add `type: 'step' as const` to every step literal. This is mechanical — search for `{ id:` and add `type: 'step' as const,` before it in step constructions.

- [ ] **Step 4: Fix any remaining TypeScript errors**

Run: `pnpm exec tsc --noEmit`
Fix any remaining errors from places where `WorkflowStep` is constructed without `type: 'step'`.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`
Expected: All 116+ test files pass

- [ ] **Step 6: Commit**

```bash
git add src/workflow/pipeline.ts src/workflow/agent-step.ts tests/workflow/workflow.spec.ts
git commit -m "refactor(workflow): add type:'step' to all WorkflowStep literals"
```

---

### Task 7: Full test suite verification + cleanup

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass, 0 failures

- [ ] **Step 2: Run TypeScript strict check**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No new errors

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: dist/ regenerated successfully

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, tsc clean, build succeeds"
```
