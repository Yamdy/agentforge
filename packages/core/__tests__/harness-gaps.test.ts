import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, type AgentDependencies } from '../src/agent.js';
import { LoopOrchestrator, type LoopOptions } from '../src/loop-orchestrator.js';
import { PipelineRunner } from '../src/pipeline.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import { JsonlCheckpointStore } from '../src/checkpoint-store.js';
import { ProcessorContextImpl } from '../src/processor-context.js';
import type { PipelineContext, Processor, StageName, ErrorHookInput, ProcessorContext } from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'test-session' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

function makePctx(overrides?: Partial<PipelineContext>): ProcessorContext {
  return new ProcessorContextImpl(makeCtx(overrides));
}

/** Register all loop stages as pass-through processors */
function registerPassThroughProcessors(runner: PipelineRunner, overrides?: Partial<Record<StageName, Processor>>) {
  const stages: StageName[] = [
    'processInput', 'buildContext', 'prepareStep', 'invokeLLM',
    'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration', 'processOutput',
  ];
  for (const stage of stages) {
    const override = overrides?.[stage];
    runner.register(override ?? { stage, execute: async () => {} });
  }
}

/** Register loop stages that complete in 1 step */
function registerCompletingProcessors(runner: PipelineRunner) {
  registerPassThroughProcessors(runner, {
    invokeLLM: {
      stage: 'invokeLLM',
      execute: async (pCtx) => {
        pCtx.state.iteration.response = 'done';
      },
    },
    evaluateIteration: {
      stage: 'evaluateIteration',
      execute: async (pCtx) => {
        pCtx.state.iteration.loopDirective = { action: 'stop' as const };
      },
    },
  });
}

// ===========================================================================
// G1: autoCheckpoint 启用路径
// ===========================================================================

describe('G1: autoCheckpoint enabled via AgentDependencies', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'g1-auto-cp-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Agent deps.autoCheckpoint=true passes autoCheckpoint to LoopOptions', async () => {
    const store = new JsonlCheckpointStore<ReturnType<typeof import('../src/serialize.js').serialize>>(dir);
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);

    const saveSpy = vi.spyOn(store, 'save');

    registerCompletingProcessors(runner);

    const orchestrator = new LoopOrchestrator(runner, hm, store, eventBus);

    const ctx = makeCtx({ request: { input: 'test', sessionId: 'g1-session' } });
    const options: LoopOptions = {
      maxIterations: 5,
      modelString: 'mock/test',
      sessionId: 'g1-session',
      autoCheckpoint: true,
    };

    await orchestrator.runLoop(ctx, options);

    expect(saveSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalledWith('g1-session', expect.anything());
  });

  it('Agent deps.autoCheckpoint=false does not pass autoCheckpoint', async () => {
    const store = new JsonlCheckpointStore<ReturnType<typeof import('../src/serialize.js').serialize>>(dir);
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);

    const saveSpy = vi.spyOn(store, 'save');

    registerCompletingProcessors(runner);

    const orchestrator = new LoopOrchestrator(runner, hm, store, eventBus);

    const ctx = makeCtx({ request: { input: 'test', sessionId: 'g1-no-auto' } });
    const options: LoopOptions = {
      maxIterations: 5,
      modelString: 'mock/test',
      sessionId: 'g1-no-auto',
    };

    await orchestrator.runLoop(ctx, options);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('Agent with deps.autoCheckpoint=true creates JsonlCheckpointStore and enables autoCheckpoint', async () => {
    const agent = new Agent(
      { model: 'mock/test', maxIterations: 2 },
      { autoCheckpoint: true, checkpointDir: dir } as AgentDependencies,
    );

    const store = (agent as unknown as { orchestrator: { checkpointStore: JsonlCheckpointStore<unknown> } }).orchestrator.checkpointStore;
    expect(store).toBeInstanceOf(JsonlCheckpointStore);

    await agent.pluginManager.shutdown();
  });
});

// ===========================================================================
// G2: default gateTool processor
// ===========================================================================

describe('G2: default gateTool processor', () => {
  it('pipeline has a gateTool stage processor registered by default', () => {
    const agent = new Agent({ model: 'mock/test' });
    const processors = (agent.pipelineRunner as unknown as { processors: Processor[] }).processors;

    const gateToolProcessors = processors.filter((p: Processor) => p.stage === 'gateTool');
    expect(gateToolProcessors.length).toBeGreaterThanOrEqual(1);
  });

  it('default gateTool processor allows tool calls to pass through', async () => {
    const agent = new Agent({ model: 'mock/test' });
    const processors = (agent.pipelineRunner as unknown as { processors: Processor[] }).processors;

    const gateToolProcessor = processors.find((p: Processor) => p.stage === 'gateTool');
    expect(gateToolProcessor).toBeDefined();

    const pCtx = makePctx({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'any_tool', args: {} }] },
    });

    await gateToolProcessor!.execute(pCtx);
    // gateTool is a no-op pass-through: state unchanged
    expect(pCtx.state.iteration.pendingToolCalls).toEqual([{ id: 'call_1', name: 'any_tool', args: {} }]);
  });

  it('gateTool processor with no pending tool calls passes through', async () => {
    const agent = new Agent({ model: 'mock/test' });
    const processors = (agent.pipelineRunner as unknown as { processors: Processor[] }).processors;
    const gateToolProcessor = processors.find((p: Processor) => p.stage === 'gateTool');

    const pCtx = makePctx({ iteration: { step: 0 } });
    await gateToolProcessor!.execute(pCtx);
    expect(pCtx.state.iteration.step).toBe(0);
  });
});

// ===========================================================================
// G3: token budget 可配置化
// ===========================================================================

describe('G3: configurable token overflow threshold', () => {
  it('evaluateIteration uses default 100k when no maxTotalTokens config', async () => {
    const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');
    const processor = createEvaluateIterationProcessor({});

    // 90k < 100k default, has tool results → continue (not overflow stop)
    const pCtx = makePctx({
      iteration: {
        step: 0,
        tokenUsage: { input: 60_000, output: 30_000 },
        pendingToolCalls: [],
        toolResults: [{ toolCallId: 'call_1', name: 'echo', output: 'hi' }],
      },
      session: {
        totalTokenUsage: { input: 0, output: 0 },
        custom: {},
      },
    });

    await processor.execute(pCtx);
    expect(pCtx.state.iteration.loopDirective?.action).toBe('continue');
  });

  it('evaluateIteration respects configurable maxTotalTokens — overflow triggers stop', async () => {
    const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');
    const processor = createEvaluateIterationProcessor({
      maxTotalTokens: 50_000,
    });

    // 90k > 50k threshold → overflow stop (overrides hasToolResults)
    const pCtx = makePctx({
      iteration: {
        step: 0,
        tokenUsage: { input: 60_000, output: 30_000 },
        pendingToolCalls: [],
        toolResults: [{ toolCallId: 'call_1', name: 'echo', output: 'hi' }],
      },
      session: {
        totalTokenUsage: { input: 0, output: 0 },
        custom: {},
      },
    });

    await processor.execute(pCtx);
    expect(pCtx.state.iteration.loopDirective?.action).toBe('stop');
  });

  it('evaluateIteration with high maxTotalTokens — no overflow, tool results → continue', async () => {
    const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');
    const processor = createEvaluateIterationProcessor({
      maxTotalTokens: 200_000,
    });

    // 90k < 200k threshold → no overflow, has tool results → continue
    const pCtx = makePctx({
      iteration: {
        step: 0,
        tokenUsage: { input: 60_000, output: 30_000 },
        pendingToolCalls: [],
        toolResults: [{ toolCallId: 'call_1', name: 'echo', output: 'hi' }],
      },
      session: {
        totalTokenUsage: { input: 0, output: 0 },
        custom: {},
      },
    });

    await processor.execute(pCtx);
    expect(pCtx.state.iteration.loopDirective?.action).toBe('continue');
  });
});

// ===========================================================================
// G4: pipeline error hook
// ===========================================================================

describe('G4: PipelineRunner fires error hook on stage failure', () => {
  it('PipelineRunner.run() invokes hookManager error hook on processor throw', async () => {
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    runner.setHookManager(hm);

    const errorHookCalls: ErrorHookInput[] = [];
    hm.register({ point: 'error', handler: (input: unknown) => { errorHookCalls.push(input as ErrorHookInput); } });

    runner.register({
      stage: 'processInput',
      execute: async () => { throw new Error('processor explosion'); },
    });

    const ctx = makeCtx();

    await expect(runner.run(ctx, ['processInput'])).rejects.toThrow('processor explosion');

    expect(errorHookCalls.length).toBe(1);
    expect((errorHookCalls[0].error as Error).message).toBe('processor explosion');
    expect(errorHookCalls[0].stage).toBe('processInput');
  });

  it('PipelineRunner.run() fires error hook for mid-pipeline stage failure', async () => {
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    runner.setHookManager(hm);

    const errorHookCalls: ErrorHookInput[] = [];
    hm.register({ point: 'error', handler: (input: unknown) => { errorHookCalls.push(input as ErrorHookInput); } });

    runner.register({ stage: 'processInput', execute: async () => {} });
    runner.register({
      stage: 'buildContext',
      execute: async () => { throw new Error('buildContext boom'); },
    });

    const ctx = makeCtx();

    await expect(runner.run(ctx, ['processInput', 'buildContext'])).rejects.toThrow('buildContext boom');

    expect(errorHookCalls.length).toBe(1);
    expect(errorHookCalls[0].stage).toBe('buildContext');
  });

  it('error hook still fires even when pipeline rethrows the error', async () => {
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    runner.setHookManager(hm);

    let hookCalled = false;
    hm.register({ point: 'error', handler: () => { hookCalled = true; } });

    runner.register({
      stage: 'invokeLLM',
      execute: async () => { throw new DOMException('LLM timeout', 'TimeoutError'); },
    });

    const ctx = makeCtx();
    await expect(runner.run(ctx, ['invokeLLM'])).rejects.toThrow();
    expect(hookCalled).toBe(true);
  });
});

// ===========================================================================
// A-1: runLoop / streamEvents equivalence
// ===========================================================================

describe('A-1: runLoop and streamEvents produce equivalent results', () => {
  function createOrchestrator() {
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    registerCompletingProcessors(runner);
    return new LoopOrchestrator(runner, hm, undefined, eventBus);
  }

  const baseOptions: LoopOptions = {
    maxIterations: 3,
    modelString: 'mock/test',
    sessionId: 'a1-session',
  };

  it('runLoop returns same context shape as streamEvents complete event', async () => {
    const ctx = makeCtx({ request: { input: 'a1-test', sessionId: 'a1-session' } });

    // runLoop path
    const runResult = await createOrchestrator().runLoop(ctx, baseOptions);

    // streamEvents path
    const events: import('@primo-ai/sdk').StreamEvent[] = [];
    for await (const event of createOrchestrator().streamEvents(ctx, baseOptions)) {
      events.push(event);
    }
    const completeEvent = [...events].reverse().find((e: import('@primo-ai/sdk').StreamEvent) => e.type === 'complete');

    expect(completeEvent).toBeDefined();
    const streamCtx = (completeEvent as { context: PipelineContext }).context;

    // Same response
    expect(runResult.context.iteration.response).toBe(streamCtx.iteration.response);
    // Same final step
    expect(runResult.context.iteration.step).toBe(streamCtx.iteration.step);
    // compatRetries exposed
    expect(typeof runResult.compatRetries).toBe('number');
  });

  it('runLoop and streamEvents both end in completed state', async () => {
    const ctx = makeCtx({ request: { input: 'a1-state', sessionId: 'a1-state' } });

    const orch1 = createOrchestrator();
    await orch1.runLoop(ctx, baseOptions);
    expect(orch1.state).toBe('completed');

    const orch2 = createOrchestrator();
    for await (const _ of orch2.streamEvents(ctx, baseOptions)) { /* drain */ }
    expect(orch2.state).toBe('completed');
  });

  it('runLoop delegates via streamCore — does not call runner.run() directly', async () => {
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    registerCompletingProcessors(runner);

    const runSpy = vi.spyOn(runner, 'run');
    const streamSpy = vi.spyOn(runner, 'stream');

    const orch = new LoopOrchestrator(runner, hm, undefined, eventBus);
    const ctx = makeCtx({ request: { input: 'a1-delegate', sessionId: 'a1-delegate' } });

    await orch.runLoop(ctx, baseOptions);

    // After A-1 fix: runLoop should NOT call runner.run(), only runner.stream()
    expect(runSpy).not.toHaveBeenCalled();
    expect(streamSpy).toHaveBeenCalled();
  });
});
