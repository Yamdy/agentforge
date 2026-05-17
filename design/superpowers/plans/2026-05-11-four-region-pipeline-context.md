# Four-Region PipelineContext Refactoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the untyped `pipeline: PipelineState` grab bag and `config: Record<string, unknown>` from PipelineContext, replacing them with ADR-0007's four-region typed model (`request`, `agent`, `iteration`, `session`).

**Architecture:** Replace `PipelineState` (with `[key: string]: unknown`) and `config: Record<string, unknown>` with structured `AgentRegion` and `IterationRegion` types. Merge `_stopLoop`/`_retryFrom` into `LoopDirective` discriminated union. Fix `promptFragments` overwrite bug. Add `messageHistory` and `currentToolCall` as typed fields.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

---

## Behaviors to Test (approved)

1. **PipelineContext shape** — context has four typed regions, no `pipeline` or untyped `config`
2. **Agent produces response in iteration region** — `Agent.run()` result accessible via `iteration.response`
3. **LoopDirective controls loop** — `{ action: 'stop' }` stops, `{ action: 'continue' }` continues, `{ action: 'retry' }` retries from stage
4. **PipelineRunner writes to iteration region** — textStream, response, tokenUsage flow through `iteration`
5. **PromptFragments accumulate without overwrite** — memory + skill processors both contribute
6. **Compression reads typed messageHistory** — no `as` casts
7. **Permission reads typed currentToolCall** — no duck-typing
8. **Session restore produces four-region context** — `SessionManager.restore()` returns new shape

---

## Tracer Bullet 1: PipelineContext Four-Region Shape

**Files:**
- Create: `packages/core/__tests__/four-region-context.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **RED: Write test asserting new PipelineContext shape**

```typescript
// packages/core/__tests__/four-region-context.test.ts
import { describe, it, expect } from 'vitest';
import type {
  PipelineContext,
  RequestRegion,
  AgentRegion,
  IterationRegion,
  SessionRegion,
  LoopDirective,
  Message,
} from '@agentforge/sdk';
import type { AgentConfig } from '@agentforge/sdk';

describe('Four-Region PipelineContext', () => {
  it('has request, agent, iteration, and session regions', () => {
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: {
        config: { model: 'test' } as AgentConfig,
        promptFragments: [],
        toolDeclarations: [],
      },
      iteration: { step: 0 },
      session: { custom: {} },
    };

    // Request region
    expect(ctx.request.input).toBe('hello');
    expect(ctx.request.sessionId).toBe('s1');

    // Agent region has typed fields
    expect(Array.isArray(ctx.agent.promptFragments)).toBe(true);
    expect(Array.isArray(ctx.agent.toolDeclarations)).toBe(true);

    // Iteration region
    expect(ctx.iteration.step).toBe(0);

    // Session region has typed custom
    expect(typeof ctx.session.custom).toBe('object');
  });

  it('supports LoopDirective discriminated union', () => {
    const stop: LoopDirective = { action: 'stop' };
    const cont: LoopDirective = { action: 'continue' };
    const retry: LoopDirective = { action: 'retry', retryFrom: 'invokeLLM' };

    expect(stop.action).toBe('stop');
    expect(cont.action).toBe('continue');
    expect(retry.action).toBe('retry');
    if (retry.action === 'retry') {
      expect(retry.retryFrom).toBe('invokeLLM');
    }
  });

  it('supports typed messageHistory in session', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: { config: {} as AgentConfig, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { messageHistory: messages, custom: {} },
    };

    expect(ctx.session.messageHistory?.length).toBe(2);
    expect(ctx.session.messageHistory?.[0].role).toBe('user');
  });

  it('does NOT have pipeline or untyped config fields', () => {
    const ctx: PipelineContext = {
      request: { input: 'hello', sessionId: 's1' },
      agent: { config: {} as AgentConfig, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { custom: {} },
    };

    // @ts-expect-error — pipeline does not exist
    expect((ctx as any).pipeline).toBeUndefined();
    // @ts-expect-error — config does not exist (renamed to agent)
    expect((ctx as any).config).toBeUndefined();
  });
});
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/core/__tests__/four-region-context.test.ts`
Expected: FAIL — types `RequestRegion`, `AgentRegion`, `IterationRegion`, `SessionRegion`, `LoopDirective`, `Message` do not exist. `PipelineContext` still has old shape.

- [ ] **GREEN: Define new types in SDK**

Modify `packages/sdk/src/index.ts`. Remove `PipelineState` interface (lines 25-31). Replace `PipelineContext` interface (lines 37-43). Add new types:

```typescript
// ---------------------------------------------------------------------------
// Message (shared by memory, compression, session)
// ---------------------------------------------------------------------------

export interface Message {
  role: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Loop Directive (replaces _stopLoop + _retryFrom)
// ---------------------------------------------------------------------------

export type LoopDirective =
  | { action: 'continue' }
  | { action: 'stop' }
  | { action: 'retry'; retryFrom: PipelineStage };

// ---------------------------------------------------------------------------
// Pipeline Context — Four Regions (ADR-0007)
// ---------------------------------------------------------------------------

export interface RequestRegion {
  input: string;
  sessionId: string;
}

export interface AgentRegion {
  config: AgentConfig;
  systemPrompt?: string;
  toolDeclarations: Array<{ name: string; description: string }>;
  /** Append-only. Always spread existing: `[...ctx.agent.promptFragments, newFragment]` */
  promptFragments: string[];
}

export interface IterationRegion {
  step: number;
  /** undefined defaults to 'continue'. Default evaluateIteration sets 'stop'. */
  loopDirective?: LoopDirective;
  textStream?: AsyncIterable<string>;
  usagePromise?: Promise<TokenUsage>;
  response?: string;
  tokenUsage?: TokenUsage;
  /** Per-stage observability span. Created by PipelineRunner.executeStage(),
   *  lives for one stage invocation (not one full iteration). */
  span?: Span;
  currentToolCall?: { name: string; args: Record<string, unknown> };
}

export interface SessionRegion {
  messageHistory?: Message[];
  totalTokenUsage?: TokenUsage;
  /** Plugin extension point. Namespaced by plugin ID. */
  custom: Record<string, unknown>;
}

export interface PipelineContext {
  request: RequestRegion;
  agent: AgentRegion;
  iteration: IterationRegion;
  session: SessionRegion;
}
```

Delete the old `PipelineState` interface entirely. Keep everything else in the file unchanged.

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/core/__tests__/four-region-context.test.ts`
Expected: PASS (4 tests)

- [ ] **COMMIT**

```bash
git add packages/sdk/src/index.ts packages/core/__tests__/four-region-context.test.ts
git commit -m "feat(sdk): define four-region PipelineContext types with LoopDirective and Message"
```

---

## Tracer Bullet 2: Agent Produces Response in Iteration Region

**Files:**
- Modify: `packages/core/src/agent.ts`
- Modify: `packages/core/src/pipeline.ts`
- Modify: `packages/core/__tests__/agent.test.ts`
- Modify: `packages/core/__tests__/full-pipeline.test.ts`

After Tracer Bullet 1, `PipelineContext` changed but `agent.ts` and `pipeline.ts` still use `ctx.pipeline` and `ctx.config`. These files won't compile. This bullet fixes them.

- [ ] **RED: Write test that Agent.run() returns response from iteration region**

```typescript
// Add to packages/core/__tests__/four-region-context.test.ts

import { Agent } from '../src/agent.js';
import { registerMockProvider } from './helpers.js';

describe('Agent with four-region context', () => {
  beforeEach(() => {
    registerMockProvider('mock', () => createMockLanguageModel({ text: 'Hello world' }));
  });

  it('produces response in iteration.region', async () => {
    const agent = new Agent({ model: 'mock/test', maxIterations: 1 });
    const response = await agent.run('Hi');

    expect(response).toBe('Hello world');
  });
});
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/core/__tests__/four-region-context.test.ts`
Expected: FAIL — `agent.ts` doesn't compile (uses old `ctx.pipeline`, `ctx.config`)

- [ ] **GREEN: Update agent.ts and pipeline.ts to use four-region context**

Update `packages/core/src/pipeline.ts` — replace all `ctx.pipeline.*` with `ctx.iteration.*`:

```typescript
// In executeStage: replace pipeline: { ...currentCtx.pipeline, _span: stageSpan }
// with: iteration: { ...currentCtx.iteration, span: stageSpan }

// In consumeTextStream: replace ctx.pipeline.textStream → ctx.iteration.textStream
// ctx.pipeline.usagePromise → ctx.iteration.usagePromise
// pipeline: { ...ctx.pipeline, response, tokenUsage, ... } → iteration: { ...ctx.iteration, ... }

// In stream(): same replacements
```

Full updated `pipeline.ts`:

```typescript
import type {
  AbortSignal,
  PipelineContext,
  PipelineStage,
  Processor,
  ProcessorResult,
  Span,
  StreamEvent,
  Tracer,
} from '@agentforge/sdk';
import { NoOpTracer } from '@agentforge/observability';

export type RunResult = PipelineContext | AbortSignal;

export interface PipelineRunnerOptions {
  tracer?: Tracer;
}

export class PipelineRunner {
  private processors: Processor[] = [];
  private tracer: Tracer;

  constructor(options?: PipelineRunnerOptions) {
    this.tracer = options?.tracer ?? new NoOpTracer();
  }

  register(processor: Processor): void {
    this.processors.push(processor);
  }

  async run(context: PipelineContext, stages: PipelineStage[]): Promise<RunResult> {
    const rootSpan = this.tracer.startSpan('pipeline');
    let ctx = context;

    try {
      for (const stage of stages) {
        const stageSpan = rootSpan.startChild(stage);
        try {
          const stageResult = await this.executeStage(ctx, stage, stageSpan);
          if (this.isAbort(stageResult)) {
            stageSpan.end();
            rootSpan.end();
            return stageResult;
          }
          ctx = stageResult;
          ctx = await this.consumeTextStream(ctx);
        } finally {
          stageSpan.end();
        }
      }
    } finally {
      rootSpan.end();
    }

    return ctx;
  }

  async *stream(context: PipelineContext, stages: PipelineStage[]): AsyncGenerator<StreamEvent> {
    const rootSpan = this.tracer.startSpan('pipeline');
    let ctx = context;

    try {
      for (const stage of stages) {
        yield { type: 'stage_start', stage };
        const stageSpan = rootSpan.startChild(stage);
        try {
          const stageResult = await this.executeStage(ctx, stage, stageSpan);
          if (this.isAbort(stageResult)) {
            stageSpan.end();
            rootSpan.end();
            yield { type: 'abort', reason: stageResult.reason };
            return;
          }
          ctx = stageResult;

          const textStream = ctx.iteration.textStream;
          if (textStream) {
            for await (const chunk of textStream) {
              yield { type: 'text_delta', text: chunk };
            }
            const usage = ctx.iteration.usagePromise
              ? await ctx.iteration.usagePromise
              : undefined;
            ctx = Object.freeze({
              ...ctx,
              iteration: {
                ...ctx.iteration,
                ...(usage ? { tokenUsage: usage } : {}),
                textStream: undefined,
                usagePromise: undefined,
              },
            });
          }
        } finally {
          stageSpan.end();
        }
        yield { type: 'stage_complete', stage };
      }
    } finally {
      rootSpan.end();
    }

    yield { type: 'complete', context: ctx };
  }

  private async executeStage(
    ctx: PipelineContext,
    stage: PipelineStage,
    stageSpan: Span,
  ): Promise<PipelineContext | AbortSignal> {
    const stageProcessors = this.processors.filter((p) => p.stage === stage);
    let currentCtx = ctx;
    for (const processor of stageProcessors) {
      const ctxWithSpan = Object.freeze({
        ...currentCtx,
        iteration: { ...currentCtx.iteration, span: stageSpan },
      });
      const result: ProcessorResult = await processor.execute(ctxWithSpan);
      if ('type' in result && result.type === 'abort') {
        return result;
      }
      currentCtx = Object.freeze({ ...(result as PipelineContext) });
    }
    return currentCtx;
  }

  private isAbort(result: PipelineContext | AbortSignal): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }

  private async consumeTextStream(ctx: PipelineContext): Promise<PipelineContext> {
    const textStream = ctx.iteration.textStream;
    if (!textStream) return ctx;

    const chunks: string[] = [];
    for await (const chunk of textStream) chunks.push(chunk);

    const usage = ctx.iteration.usagePromise
      ? await ctx.iteration.usagePromise
      : undefined;

    return Object.freeze({
      ...ctx,
      iteration: {
        ...ctx.iteration,
        response: chunks.join(''),
        ...(usage ? { tokenUsage: usage } : {}),
        textStream: undefined,
        usagePromise: undefined,
      },
    });
  }
}
```

Update `packages/core/src/agent.ts` — full replacement:

```typescript
import type {
  AbortSignal,
  AgentConfig,
  PipelineContext,
  PipelineStage,
  Processor,
  Tool,
} from '@agentforge/sdk';
import { PipelineRunner } from './pipeline.js';
import { ToolRegistry } from './tool-registry.js';
import { PluginManager, type PluginFactory } from './plugin-manager.js';
import { LLMInvoker } from './llm-invoker.js';
import { resolveModel } from './model-resolver.js';
import { echoTool } from '@agentforge/tools';

const PRE_LOOP_STAGES: PipelineStage[] = ['processInput', 'buildContext'];
const LOOP_STAGES: PipelineStage[] = [
  'prepareStep', 'invokeLLM', 'processStepOutput', 'executeTools', 'evaluateIteration',
];
const POST_LOOP_STAGES: PipelineStage[] = ['processOutput'];

export class Agent {
  private config: AgentConfig;
  private runner: PipelineRunner;
  private registry: ToolRegistry;
  private _pluginManager: PluginManager;
  private _llm: LLMInvoker | null = null;

  constructor(config: AgentConfig, options?: { tracer?: import('@agentforge/sdk').Tracer }) {
    this.config = config;
    this.runner = new PipelineRunner({ tracer: options?.tracer });
    this.registry = new ToolRegistry();
    this._pluginManager = new PluginManager(this.runner, this.registry);
    this.registerTools();
    this.registerBuiltinProcessors();
  }

  use(factory: Processor | PluginFactory): void {
    if (typeof factory === 'function') {
      this._pluginManager.initializePlugin(factory as PluginFactory);
    } else {
      this.runner.register(factory as Processor);
    }
  }

  get pipelineRunner(): PipelineRunner { return this.runner; }
  get toolRegistry(): ToolRegistry { return this.registry; }
  get pluginManager(): PluginManager { return this._pluginManager; }

  async run(input: string): Promise<string> {
    const context = this.createContext(input);
    const maxIter = this.config.maxIterations ?? 10;

    let result = await this.runner.run(context, PRE_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

    let ctx = result as PipelineContext;
    for (let i = 0; i < maxIter; i++) {
      ctx = { ...ctx, iteration: { ...ctx.iteration, step: i } };

      const directive = ctx.iteration.loopDirective;
      let stages: PipelineStage[];
      if (directive?.action === 'retry' && directive.retryFrom) {
        stages = LOOP_STAGES.slice(LOOP_STAGES.indexOf(directive.retryFrom));
      } else {
        stages = LOOP_STAGES;
      }
      ctx = { ...ctx, iteration: { ...ctx.iteration, loopDirective: undefined } };

      result = await this.runner.run(ctx, stages);
      if (this.isAbort(result)) {
        const abort = result as AbortSignal;
        if (abort.retryFrom) {
          ctx = { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'retry', retryFrom: abort.retryFrom } } };
          continue;
        }
        throw new Error(`Agent aborted: ${abort.reason}`);
      }
      ctx = result as PipelineContext;

      const d = ctx.iteration.loopDirective;
      if (d?.action === 'stop') break;
      if (d?.action === 'retry' && d.retryFrom) continue;
    }

    result = await this.runner.run(ctx, POST_LOOP_STAGES);
    if (this.isAbort(result)) throw new Error(`Agent aborted: ${(result as AbortSignal).reason}`);

    return (result as PipelineContext).iteration.response ?? '';
  }

  async *stream(input: string): AsyncGenerator<string> {
    const context = this.createContext(input);
    const maxIter = this.config.maxIterations ?? 10;

    let ctx = context;
    for await (const event of this.runner.stream(ctx, PRE_LOOP_STAGES)) {
      if (event.type === 'text_delta') yield event.text;
      if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
    }

    for (let i = 0; i < maxIter; i++) {
      ctx = { ...ctx, iteration: { ...ctx.iteration, step: i } };
      for await (const event of this.runner.stream(ctx, LOOP_STAGES)) {
        if (event.type === 'text_delta') yield event.text;
        if (event.type === 'complete') ctx = (event as { context: PipelineContext }).context;
      }
      const d = ctx.iteration.loopDirective;
      if (d?.action === 'stop') break;
    }

    for await (const event of this.runner.stream(ctx, POST_LOOP_STAGES)) {
      if (event.type === 'text_delta') yield event.text;
    }
  }

  private async getLLM(): Promise<LLMInvoker> {
    if (!this._llm) {
      const model = await resolveModel(this.config.model);
      this._llm = new LLMInvoker({
        model,
        system: this.config.systemPrompt,
        retryOptions: { maxRetries: 3, baseDelay: 1000 },
      });
    }
    return this._llm;
  }

  private createContext(input: string): PipelineContext {
    return {
      request: { input, sessionId: crypto.randomUUID() },
      agent: {
        config: { ...this.config },
        promptFragments: [],
        toolDeclarations: [],
      },
      iteration: { step: 0 },
      session: { custom: {} },
    };
  }

  private registerTools(): void {
    const userToolNames = new Set((this.config.tools ?? []).map(t => t.name));
    if (!userToolNames.has(echoTool.name)) {
      this.registry.register(echoTool as Tool);
    }
    for (const tool of this.config.tools ?? []) {
      this.registry.register(tool as Tool);
    }
  }

  private registerBuiltinProcessors(): void {
    const processInput: Processor = {
      stage: 'processInput',
      execute: async (ctx) => ctx,
    };

    const buildContext: Processor = {
      stage: 'buildContext',
      execute: async (ctx) => ({
        ...ctx,
        agent: {
          ...ctx.agent,
          systemPrompt: this.config.systemPrompt,
          toolDeclarations: this.registry.getAll().map(t => ({
            name: t.name,
            description: t.description,
          })),
        },
      }),
    };

    const prepareStep: Processor = {
      stage: 'prepareStep',
      execute: async (ctx) => ctx,
    };

    const invokeLLM: Processor = {
      stage: 'invokeLLM',
      execute: async (ctx) => {
        const llm = await this.getLLM();
        const sdkTools = this.registry.toAiSdkTools();

        this.registry.setToolExecutionContext({
          span: {
            spanId: `tool-${ctx.request.sessionId}-${ctx.iteration.step}`,
            traceId: ctx.request.sessionId,
          },
          sessionId: ctx.request.sessionId,
          pluginManager: this._pluginManager,
        });

        const handle = llm.stream({
          prompt: ctx.request.input,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          maxSteps: this.config.maxIterations,
        });

        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            textStream: handle.textStream,
            usagePromise: handle.usage,
          },
        };
      },
    };

    const processStepOutput: Processor = {
      stage: 'processStepOutput',
      execute: async (ctx) => ctx,
    };

    const executeTools: Processor = {
      stage: 'executeTools',
      execute: async (ctx) => ctx,
    };

    const evaluateIteration: Processor = {
      stage: 'evaluateIteration',
      execute: async (ctx) => ({
        ...ctx,
        iteration: {
          ...ctx.iteration,
          loopDirective: { action: 'stop' },
        },
      }),
    };

    const processOutput: Processor = {
      stage: 'processOutput',
      execute: async (ctx) => ctx,
    };

    this.runner.register(processInput);
    this.runner.register(buildContext);
    this.runner.register(prepareStep);
    this.runner.register(invokeLLM);
    this.runner.register(processStepOutput);
    this.runner.register(executeTools);
    this.runner.register(evaluateIteration);
    this.runner.register(processOutput);
  }

  private isAbort(result: PipelineContext | AbortSignal): result is AbortSignal {
    return 'type' in result && result.type === 'abort';
  }
}
```

Update session-manager.ts `restore()` return value:

```typescript
return {
  request: { input, sessionId },
  agent: { config: {} as any, promptFragments: [], toolDeclarations: [] },
  iteration: { step: lastStep },
  session: { messageHistory: messageHistory as any, custom: {} },
};
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/core/__tests__/four-region-context.test.ts`
Expected: PASS

- [ ] **COMMIT**

```bash
git add packages/core/src/agent.ts packages/core/src/pipeline.ts packages/core/src/session-manager.ts
git commit -m "refactor(core): migrate Agent and PipelineRunner to four-region context"
```

---

## Tracer Bullet 3: LoopDirective Controls Agent Loop

**Files:**
- Modify: `packages/core/__tests__/four-region-context.test.ts`

The Agent loop now reads `loopDirective`. The default evaluateIteration sets `{ action: 'stop' }`. Test that a custom evaluateIteration can continue or retry.

- [ ] **RED: Write LoopDirective behavior tests**

```typescript
// Add to four-region-context.test.ts

describe('LoopDirective', () => {
  beforeEach(() => {
    registerMockProvider('mock', () => createMockLanguageModel({ text: 'step done' }));
  });

  it('stops after first iteration when evaluateIteration sets stop (default)', async () => {
    const agent = new Agent({ model: 'mock/test', maxIterations: 5 });
    const response = await agent.run('test');
    // Default evaluateIteration sets { action: 'stop' }, so only 1 iteration
    expect(response).toBe('step done');
  });

  it('continues loop when evaluateIteration sets continue', async () => {
    const agent = new Agent({ model: 'mock/test', maxIterations: 5 });
    let iterations = 0;

    agent.use({
      stage: 'evaluateIteration',
      execute: async (ctx) => {
        iterations++;
        return {
          ...ctx,
          iteration: {
            ...ctx.iteration,
            loopDirective: iterations < 3 ? { action: 'continue' } : { action: 'stop' },
          },
        };
      },
    });

    await agent.run('test');
    expect(iterations).toBe(3);
  });
});
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/core/__tests__/four-region-context.test.ts`
Expected: PASS (loopDirective already implemented in Tracer Bullet 2)

- [ ] **COMMIT**

```bash
git add packages/core/__tests__/four-region-context.test.ts
git commit -m "test(core): verify LoopDirective controls agent loop behavior"
```

---

## Tracer Bullet 4: PromptFragments Accumulate Without Overwrite

**Files:**
- Modify: `packages/plugins/src/memory/memory-processor.ts`
- Modify: `packages/plugins/src/skill/skill-processor.ts`
- Modify: `packages/plugins/__tests__/memory-processor.test.ts`
- Modify: `packages/plugins/__tests__/skill-plugin.test.ts`

- [ ] **RED: Write test that memory + skill both contribute fragments**

```typescript
// Add to packages/plugins/__tests__/four-region-fragments.test.ts

import { describe, it, expect } from 'vitest';
import type { PipelineContext, AgentConfig } from '@agentforge/sdk';
import { createMemoryProcessor } from '../src/memory/memory-processor.js';

function makeContext(): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'test' } as AgentConfig, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
  };
}

describe('PromptFragments accumulation', () => {
  it('memory processor appends to existing fragments (does not overwrite)', async () => {
    const backend = {
      retrieve: async () => [
        { role: 'user' as const, content: 'remember this', timestamp: '' },
      ],
      store: async () => {},
    };

    const processor = createMemoryProcessor({
      backend,
      triggerMode: { type: 'automatic', onLoad: 'always' },
    });

    // Simulate skill processor having already added a fragment
    const ctx: PipelineContext = {
      ...makeContext(),
      agent: {
        ...makeContext().agent,
        promptFragments: ['<skills>Skill fragment here</skills>'],
      },
    };

    const result = await processor.execute(ctx);
    if ('type' in result && result.type === 'abort') throw new Error('unexpected abort');

    const fragments = (result as PipelineContext).agent.promptFragments;
    expect(fragments.length).toBe(2); // skill + memory, not just memory
    expect(fragments[0]).toContain('Skill fragment');
    expect(fragments[1]).toContain('<memory>');
  });
});
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/plugins/__tests__/four-region-fragments.test.ts`
Expected: FAIL — memory processor replaces array instead of appending

- [ ] **GREEN: Fix memory-processor to append; update skill-processor to use agent region**

Update `packages/plugins/src/memory/memory-processor.ts`:

```typescript
import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import type { MemoryBackend } from './backend.js';

export type MemoryTriggerMode =
  | { type: 'automatic'; onLoad: 'always' | 'on-session-start' }
  | { type: 'agent-controlled' }
  | { type: 'both' };

export interface MemoryConfig {
  backend: MemoryBackend;
  triggerMode: MemoryTriggerMode;
  windowLimit?: number;
}

export function createMemoryProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode, windowLimit } = config;

  return {
    stage: 'buildContext',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (triggerMode.type === 'agent-controlled') return ctx;

      const entries = await backend.retrieve(ctx.request.sessionId, {
        limit: windowLimit,
      });

      if (entries.length === 0) return ctx;

      const messageHistory = entries.map((e) => ({
        role: e.role,
        content: e.content,
      }));

      const memoryBlock = entries
        .map((e) => `[${e.role}] ${e.content}`)
        .join('\n');
      // APPEND to existing fragments — do not replace
      const promptFragments = [...ctx.agent.promptFragments, `<memory>\n${memoryBlock}\n</memory>`];

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory },
        agent: { ...ctx.agent, promptFragments },
      };
    },
  };
}

export function createMemoryOutputProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode } = config;

  return {
    stage: 'processOutput',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (triggerMode.type === 'agent-controlled') return ctx;

      const response = ctx.iteration.response;
      if (!response) return ctx;

      const now = new Date().toISOString();
      await backend.store(ctx.request.sessionId, {
        role: 'user',
        content: ctx.request.input,
        timestamp: now,
      });
      await backend.store(ctx.request.sessionId, {
        role: 'assistant',
        content: response,
        timestamp: new Date(Date.now() + 1).toISOString(),
      });

      return ctx;
    },
  };
}
```

Update `packages/plugins/src/skill/skill-processor.ts` — change `ctx.pipeline.promptFragments` → `ctx.agent.promptFragments`:

In the buildContext processor's execute method:

```typescript
execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
  if (skills.length === 0) return ctx;

  const lines = skills.map(
    (s) => `- **${s.name}**: ${s.description}`,
  );
  const fragment = `<skills>\nAvailable skills (use read_skill tool to load full instructions):\n${lines.join('\n')}\n</skills>`;

  const existingFragments = ctx.agent.promptFragments;
  return {
    ...ctx,
    agent: {
      ...ctx.agent,
      promptFragments: [...existingFragments, fragment],
    },
  };
},
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/plugins/__tests__/four-region-fragments.test.ts`
Expected: PASS

- [ ] **COMMIT**

```bash
git add packages/plugins/src/memory/memory-processor.ts packages/plugins/src/skill/skill-processor.ts packages/plugins/__tests__/four-region-fragments.test.ts
git commit -m "fix(plugins): promptFragments append-only, use agent region"
```

---

## Tracer Bullet 5: Compression Reads Typed messageHistory

**Files:**
- Modify: `packages/plugins/src/compression/compression-processor.ts`

- [ ] **RED: Write test that compression uses typed messageHistory**

```typescript
// Add to packages/plugins/__tests__/four-region-fragments.test.ts

import { createCompressionProcessor } from '../src/compression/compression-processor.js';
import type { Message } from '@agentforge/sdk';

it('compression processor reads typed messageHistory without casts', async () => {
  const messages: Message[] = [
    { role: 'user', content: 'a'.repeat(1000) },
    { role: 'assistant', content: 'b'.repeat(1000) },
  ];

  const processor = createCompressionProcessor({
    maxContextTokens: 100,
    phases: [{ type: 'truncate', maxLength: 10 }],
  });

  const ctx: PipelineContext = {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'test' } as AgentConfig, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { messageHistory: messages, custom: {} },
  };

  const result = await processor.execute(ctx);
  if ('type' in result && result.type === 'abort') throw new Error('unexpected abort');

  const typedCtx = result as PipelineContext;
  // No 'as Message[]' cast needed — typed access
  expect(typedCtx.session.messageHistory).toBeDefined();
  expect(typedCtx.session.messageHistory!.length).toBe(2);
  expect(typedCtx.session.messageHistory![0].content.length).toBeLessThan(1000);
});
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/plugins/__tests__/four-region-fragments.test.ts`
Expected: FAIL — compression-processor still uses `ctx.pipeline._span` and old `ctx.session.messageHistory as Message[]`

- [ ] **GREEN: Update compression-processor to use typed access**

Update `packages/plugins/src/compression/compression-processor.ts`:

```typescript
import type { Processor, PipelineContext, ProcessorResult, Message } from '@agentforge/sdk';

// Remove the local: export type Message = { role: string; content: string };
// Import Message from @agentforge/sdk instead

export type SummarizeFn = (messages: Message[]) => Promise<string>;

export type CompressionPhase =
  | { type: 'truncate'; maxLength: number }
  | { type: 'summarize'; model: string; maxTokens: number; summarizeFn?: SummarizeFn }
  | { type: 'prune'; keepRecent: number };

export interface CompressionConfig {
  maxContextTokens: number;
  phases: CompressionPhase[];
}

function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

function applyTruncate(messages: Message[], maxLength: number): Message[] {
  return messages.map((m) =>
    m.content.length > maxLength
      ? { ...m, content: m.content.slice(0, maxLength - 3) + '...' }
      : m,
  );
}

async function applySummarize(
  messages: Message[],
  phase: Extract<CompressionPhase, { type: 'summarize' }>,
): Promise<Message[]> {
  if (messages.length <= 1) return messages;
  const summarizeFn = phase.summarizeFn;
  if (!summarizeFn) return messages;
  const summary = await summarizeFn(messages);
  return [{ role: 'system', content: summary }];
}

export function createCompressionProcessor(config: CompressionConfig): Processor {
  return {
    stage: 'prepareStep',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      const history = ctx.session.messageHistory; // Typed — no cast
      if (!history || history.length === 0) return ctx;

      const tokensBefore = estimateTokens(history);
      if (tokensBefore <= config.maxContextTokens) return ctx;

      let compressed = [...history];
      let phasesApplied = 0;

      for (const phase of config.phases) {
        if (phase.type === 'truncate') {
          compressed = applyTruncate(compressed, phase.maxLength);
          phasesApplied++;
        } else if (phase.type === 'prune') {
          compressed = compressed.slice(-phase.keepRecent);
          phasesApplied++;
        } else if (phase.type === 'summarize') {
          compressed = await applySummarize(compressed, phase);
          phasesApplied++;
        }
      }

      const tokensAfter = estimateTokens(compressed);
      const span = ctx.iteration.span; // Typed — no cast
      if (span) {
        span
          .setAttribute('compression.triggered', true)
          .setAttribute('compression.phases_applied', phasesApplied)
          .setAttribute('compression.tokens_before', tokensBefore)
          .setAttribute('compression.tokens_after', tokensAfter);
      }

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory: compressed },
      };
    },
  };
}
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/plugins/__tests__/four-region-fragments.test.ts`
Expected: PASS

- [ ] **COMMIT**

```bash
git add packages/plugins/src/compression/compression-processor.ts packages/plugins/__tests__/four-region-fragments.test.ts
git commit -m "refactor(plugins): compression uses typed messageHistory and span from four-region context"
```

---

## Tracer Bullet 6: Permission Reads Typed currentToolCall

**Files:**
- Modify: `packages/plugins/src/permission/permission-processor.ts`

- [ ] **RED: Write test that permission reads typed currentToolCall**

```typescript
// Add to packages/plugins/__tests__/four-region-fragments.test.ts

it('permission processor reads typed currentToolCall from iteration', async () => {
  const { createPermissionProcessor } = await import('../src/permission/permission-processor.js');
  const processor = createPermissionProcessor({
    mode: 'full-auto',
    rules: [{ tool: 'shell_exec', action: 'deny' }],
  });

  const ctx: PipelineContext = {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'test' } as AgentConfig, promptFragments: [], toolDeclarations: [] },
    iteration: {
      step: 0,
      currentToolCall: { name: 'shell_exec', args: { command: 'rm -rf /' } },
    },
    session: { custom: {} },
  };

  const result = await processor.execute(ctx);
  // Should abort because shell_exec is denied
  expect('type' in result && result.type === 'abort').toBe(true);
});
```

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/plugins/__tests__/four-region-fragments.test.ts`
Expected: FAIL — permission-processor still uses `ctx.pipeline as Record<string, unknown>` duck-typing

- [ ] **GREEN: Update permission-processor to use typed access**

Replace `getCurrentToolCall` helper (lines 94-101) in `permission-processor.ts`:

```typescript
function getCurrentToolCall(ctx: PipelineContext): { name: string; args: Record<string, unknown> } | undefined {
  return ctx.iteration.currentToolCall;
}
```

This eliminates the entire duck-typing dance. The function goes from 7 lines to 1 line.

Run: `cd C:/Users/90514/code/new && pnpm exec vitest run packages/plugins/__tests__/four-region-fragments.test.ts`
Expected: PASS

- [ ] **COMMIT**

```bash
git add packages/plugins/src/permission/permission-processor.ts packages/plugins/__tests__/four-region-fragments.test.ts
git commit -m "refactor(plugins): permission uses typed currentToolCall from iteration region"
```

---

## Tracer Bullet 7: Migrate All Existing Tests

This is the "make everything green" pass. All source modules are now migrated. All existing tests still use old `pipeline`/`config` shapes. Fix them mechanically.

**Files:**
- Modify: All 33 test files across `packages/core/__tests__/` and `packages/plugins/__tests__/`
- Modify: `packages/sdk/__tests__/exports.test.ts`

- [ ] **Apply mechanical transformation to all test files**

Transformation table:

```
Old                                   → New
────────────────────────────────────────────────────────────────────────
pipeline: {}                          → (remove from context construction)
config: {}                            → agent: { config: { model: 'mock/test' } as AgentConfig, promptFragments: [], toolDeclarations: [] }
config: { model: '...', ... }         → agent: { config: { model: '...', ... } as AgentConfig, promptFragments: [], toolDeclarations: [] }
session: {}                           → session: { custom: {} }
session: { messageHistory: [...] }    → session: { messageHistory: [...], custom: {} }
session: { ...ctx.session, ...spread }→ (same — spread preserves custom)
ctx.pipeline.response                 → ctx.iteration.response
ctx.pipeline.tokenUsage               → ctx.iteration.tokenUsage
ctx.pipeline._span as Span            → ctx.iteration.span
ctx.pipeline._stopLoop                → ctx.iteration.loopDirective?.action === 'stop'
ctx.pipeline.systemPrompt             → ctx.agent.systemPrompt
ctx.pipeline.toolDeclarations         → ctx.agent.toolDeclarations
ctx.pipeline.currentToolCall          → ctx.iteration.currentToolCall
pipeline: { currentToolCall: {...} }  → iteration: { step: 0, currentToolCall: {...} }
pipeline: { response: '...' }         → iteration: { step: 0, response: '...' }
{ ...ctx, pipeline: { _stopLoop: t } } → { ...ctx, iteration: { ...ctx.iteration, loopDirective: { action: 'stop' } } }
(ctx.session as Record<string,unknown>).messageHistory → ctx.session.messageHistory
result.pipeline.transformed           → result.session.custom.transformed
```

Test-specific context helpers:

```typescript
// In files that have makeContext helpers, update to:
import type { AgentConfig } from '@agentforge/sdk';
const testConfig: AgentConfig = { model: 'mock/test' };

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: testConfig, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}
```

Affected test files (33):
- Core (20): `pipeline.test.ts`, `pipeline-streaming.test.ts`, `pipeline-observability.test.ts`, `agent.test.ts`, `agent-tool-loop.test.ts`, `llm-invoker.test.ts`, `tool-registry.test.ts`, `tool-calls.test.ts`, `plugin-manager.test.ts`, `session-storage.test.ts`, `session-manager.test.ts`, `session-persistence.test.ts`, `sub-agent.test.ts`, `event-bus.test.ts`, `retry.test.ts`, `resolve-model.test.ts`, `full-pipeline.test.ts`, `streaming.test.ts`, `token-usage.test.ts`, `four-region-context.test.ts` ✓
- Plugins (9): `compression-processor.test.ts`, `memory-processor.test.ts`, `memory-plugin.test.ts`, `memory-backend.test.ts`, `sqlite-backend.test.ts`, `eviction.test.ts`, `permission-processor.test.ts`, `permission-plugin.test.ts`, `skill-plugin.test.ts`
- SDK (1): `exports.test.ts` — update to import new types, remove PipelineState
- Tools (1): `echo.test.ts` — likely no changes needed
- Observability (4): `noop.test.ts`, `span.test.ts`, `exporter.test.ts`, `otel-bridge.test.ts` — likely no changes needed

- [ ] **Run full test suite**

Run: `cd C:/Users/90514/code/new && pnpm test`
Expected: All tests pass

- [ ] **COMMIT**

```bash
git add -A
git commit -m "test: migrate all tests to four-region PipelineContext"
```

---

## Refactor: Cleanup and Verification

- [ ] **Verify no old references remain**

Run:
```bash
cd C:/Users/90514/code/new
grep -rn "ctx\.pipeline" packages/ --include="*.ts" || echo "CLEAN"
grep -rn "PipelineState" packages/ --include="*.ts" || echo "CLEAN"
grep -rn "ctx\.config\b" packages/ --include="*.ts" || echo "CLEAN"
grep -rn "_stopLoop\|_retryFrom\|_span" packages/ --include="*.ts" || echo "CLEAN"
```
Expected: `CLEAN` for all four checks

- [ ] **Run type checking**

Run: `cd C:/Users/90514/code/new && pnpm check-types`
Expected: No errors

- [ ] **Final commit if cleanup needed**

```bash
git add -A
git commit -m "refactor: complete four-region PipelineContext migration (ADR-0007)"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ PipelineState eliminated (Tracer Bullet 1)
- ✅ `config` → `agent` rename (Tracer Bullet 2)
- ✅ `session` structured with `messageHistory`, `totalTokenUsage`, `custom` (Tracer Bullet 1)
- ✅ `_stopLoop`/`_retryFrom` → `LoopDirective` (Tracer Bullet 2, verified in 3)
- ✅ `_span` → `span` in iteration (Tracer Bullet 2)
- ✅ `currentToolCall` in iteration (Tracer Bullet 6)
- ✅ `promptFragments` append-only fix (Tracer Bullet 4)
- ✅ `messageHistory` typed access (Tracer Bullet 5)
- ✅ All source files migrated (Tracer Bullets 2, 4, 5, 6)
- ✅ All test files migrated (Tracer Bullet 7)

**2. Placeholder scan:** No TBD/TODO/fill-in-details found. All steps contain actual code or exact commands.

**3. Type consistency:**
- `AgentConfig` used consistently (test helpers use `{ model: 'mock/test' } as AgentConfig`)
- `Message` imported from `@agentforge/sdk` (local alias removed in compression-processor)
- `LoopDirective` discriminated union used consistently
- `SessionRegion.custom` initialized as `{}` everywhere
- `AgentRegion.promptFragments` initialized as `[]` everywhere
- `AgentRegion.toolDeclarations` initialized as `[]` everywhere
