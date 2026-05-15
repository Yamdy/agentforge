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
import type { PipelineContext, Processor, PipelineStage } from '@agentforge/sdk';

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

/** Register all loop stages as pass-through processors */
function registerPassThroughProcessors(runner: PipelineRunner, overrides?: Partial<Record<PipelineStage, Processor>>) {
  const stages: PipelineStage[] = [
    'processInput', 'buildContext', 'prepareStep', 'invokeLLM',
    'processStepOutput', 'gateTool', 'executeTools', 'evaluateIteration', 'processOutput',
  ];
  for (const stage of stages) {
    const override = overrides?.[stage];
    runner.register(override ?? { stage, execute: async (ctx) => ctx });
  }
}

/** Register loop stages that complete in 1 step */
function registerCompletingProcessors(runner: PipelineRunner) {
  registerPassThroughProcessors(runner, {
    invokeLLM: {
      stage: 'invokeLLM',
      execute: async (ctx: PipelineContext) => ({
        ...ctx,
        iteration: { ...ctx.iteration, response: 'done' },
      }),
    },
    evaluateIteration: {
      stage: 'evaluateIteration',
      execute: async (ctx: PipelineContext) => ({
        ...ctx,
        iteration: { ...ctx.iteration, loopDirective: { action: 'stop' as const } },
      }),
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

    const store = (agent as any).orchestrator.checkpointStore;
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
    const processors: Processor[] = (agent.pipelineRunner as any).processors;

    const gateToolProcessors = processors.filter((p: Processor) => p.stage === 'gateTool');
    expect(gateToolProcessors.length).toBeGreaterThanOrEqual(1);
  });

  it('default gateTool processor allows tool calls to pass through', async () => {
    const agent = new Agent({ model: 'mock/test' });
    const processors: Processor[] = (agent.pipelineRunner as any).processors;

    const gateToolProcessor = processors.find((p: Processor) => p.stage === 'gateTool');
    expect(gateToolProcessor).toBeDefined();

    const ctx = makeCtx({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'any_tool', args: {} }] },
    });

    const result = await gateToolProcessor!.execute(ctx);
    expect(result).toEqual(ctx);
    expect('type' in (result as any)).toBe(false);
  });

  it('gateTool processor with no pending tool calls passes through', async () => {
    const agent = new Agent({ model: 'mock/test' });
    const processors: Processor[] = (agent.pipelineRunner as any).processors;
    const gateToolProcessor = processors.find((p: Processor) => p.stage === 'gateTool');

    const ctx = makeCtx({ iteration: { step: 0 } });
    const result = await gateToolProcessor!.execute(ctx);
    expect(result).toEqual(ctx);
  });
});

// ===========================================================================
// G3: token budget 可配置化
// ===========================================================================

describe('G3: configurable token overflow threshold', () => {
  it('evaluateIteration uses default 100k when no maxTotalTokens config', async () => {
    const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');
    const processor = createEvaluateIterationProcessor({});

    const ctx = makeCtx({
      iteration: {
        step: 0,
        tokenUsage: { input: 60_000, output: 30_000 },
        pendingToolCalls: [],
      },
      session: {
        totalTokenUsage: { input: 0, output: 0 },
        custom: {},
      },
    });

    const result = await processor.execute(ctx);
    expect((result as PipelineContext).iteration.loopDirective?.action).not.toBe('stop');
  });

  it('evaluateIteration respects configurable maxTotalTokens from config', async () => {
    const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');
    const processor = createEvaluateIterationProcessor(
      // @ts-expect-error — maxTotalTokens does not exist yet (RED for G3)
      { maxTotalTokens: 50_000 },
    );

    const ctx = makeCtx({
      iteration: {
        step: 0,
        tokenUsage: { input: 60_000, output: 30_000 },
        pendingToolCalls: [],
      },
      session: {
        totalTokenUsage: { input: 0, output: 0 },
        custom: {},
      },
    });

    const result = await processor.execute(ctx);
    expect((result as PipelineContext).iteration.loopDirective?.action).toBe('stop');
  });

  it('evaluateIteration with high maxTotalTokens does not stop when under threshold', async () => {
    const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');
    const processor = createEvaluateIterationProcessor(
      // @ts-expect-error — maxTotalTokens does not exist yet (RED for G3)
      { maxTotalTokens: 200_000 },
    );

    const ctx = makeCtx({
      iteration: {
        step: 0,
        tokenUsage: { input: 60_000, output: 30_000 },
        pendingToolCalls: [],
      },
      session: {
        totalTokenUsage: { input: 0, output: 0 },
        custom: {},
      },
    });

    const result = await processor.execute(ctx);
    expect((result as PipelineContext).iteration.loopDirective?.action).not.toBe('stop');
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

    const errorHookCalls: any[] = [];
    hm.register({ point: 'error', handler: (input) => { errorHookCalls.push(input); } });

    runner.register({
      stage: 'processInput',
      execute: async () => { throw new Error('processor explosion'); },
    });

    const ctx = makeCtx();

    await expect(runner.run(ctx, ['processInput'])).rejects.toThrow('processor explosion');

    expect(errorHookCalls.length).toBe(1);
    expect(errorHookCalls[0].error.message).toBe('processor explosion');
    expect(errorHookCalls[0].stage).toBe('processInput');
  });

  it('PipelineRunner.run() fires error hook for mid-pipeline stage failure', async () => {
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    runner.setHookManager(hm);

    const errorHookCalls: any[] = [];
    hm.register({ point: 'error', handler: (input) => { errorHookCalls.push(input); } });

    runner.register({ stage: 'processInput', execute: async (ctx) => ctx });
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
