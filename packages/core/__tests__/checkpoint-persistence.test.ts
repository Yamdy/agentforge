import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent, type AgentDependencies } from '../src/agent.js';
import { JsonlCheckpointStore } from '../src/checkpoint-store.js';
import { InMemoryCheckpointStore } from '../src/checkpoint-store.js';
import { LoopOrchestrator, type LoopOptions } from '../src/loop-orchestrator.js';
import { PipelineRunner } from '../src/pipeline.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import { serialize } from '../src/serialize.js';
import type { CheckpointStore, PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '../src/processor-context.js';

describe('Checkpoint persistence (P0)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Agent with checkpointDir uses JsonlCheckpointStore', () => {
    const deps: AgentDependencies = { checkpointDir: dir };
    const agent = new Agent({ model: 'mock/test' }, deps);

    const store = (agent as unknown as { orchestrator: { checkpointStore: CheckpointStore<unknown> } }).orchestrator.checkpointStore;
    expect(store).toBeInstanceOf(JsonlCheckpointStore);
  });

  it('Agent without checkpointDir defaults to JsonlCheckpointStore', () => {
    const agent = new Agent({ model: 'mock/test' });

    const store = (agent as unknown as { orchestrator: { checkpointStore: CheckpointStore<unknown> } }).orchestrator.checkpointStore;
    expect(store).toBeInstanceOf(JsonlCheckpointStore);
  });

  it('JsonlCheckpointStore persists data across instances', async () => {
    const store1 = new JsonlCheckpointStore(dir);
    await store1.save('session-1', { step: 5, status: 'paused' });

    const store2 = new JsonlCheckpointStore(dir);
    const loaded = await store2.load('session-1');

    expect(loaded).toEqual({ step: 5, status: 'paused' });
  });

  it('explicit checkpointStore overrides checkpointDir', () => {
    const explicit = new InMemoryCheckpointStore<ReturnType<typeof import('../src/serialize.js').serialize>>();
    const deps: AgentDependencies = { checkpointDir: dir, checkpointStore: explicit };
    const agent = new Agent({ model: 'mock/test' }, deps);

    const store = (agent as unknown as { orchestrator: { checkpointStore: CheckpointStore<unknown> } }).orchestrator.checkpointStore;
    expect(store).toBe(explicit);
  });
});

describe('Auto checkpoint per iteration (P0)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auto-checkpoint-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('autoCheckpoint=true saves checkpoint after each iteration', async () => {
    const store = new JsonlCheckpointStore<ReturnType<typeof import('../src/serialize.js').serialize>>(dir);
    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    const orchestrator = new LoopOrchestrator(runner, hm, store);

    // Register a processor that completes in 1 step
    runner.register({
      stage: 'processInput',
      execute: async () => {},
    });
    runner.register({
      stage: 'buildContext',
      execute: async () => {},
    });
    runner.register({
      stage: 'prepareStep',
      execute: async () => {},
    });
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.response = 'done';
      },
    });
    runner.register({
      stage: 'processStepOutput',
      execute: async () => {},
    });
    runner.register({
      stage: 'executeTools',
      execute: async () => {},
    });
    runner.register({
      stage: 'evaluateIteration',
      execute: async (pCtx: ProcessorContext) => {
        pCtx.state.iteration.loopDirective = { action: 'stop' };
      },
    });
    runner.register({
      stage: 'processOutput',
      execute: async () => {},
    });

    const ctx: PipelineContext = {
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { input: 'test', sessionId: 'auto-cp-1', custom: {} },
    };

    const options: LoopOptions = {
      maxIterations: 5,
      modelString: 'mock/test',
      sessionId: 'auto-cp-1',
      autoCheckpoint: true,
    };

    await orchestrator.runLoop(ctx, options);

    // After loop completes, a checkpoint should exist for the session
    const checkpoint = await store.load('auto-cp-1');
    expect(checkpoint).toBeDefined();
  });

  it('autoCheckpoint=false (default) does not save checkpoint', async () => {
    const saveSpy = [] as string[];
    const store: import('@primo-ai/sdk').CheckpointStore<unknown> = {
      save: async (id) => { saveSpy.push(id); },
      load: async () => undefined,
      delete: async () => {},
      list: async () => [],
    };

    const runner = new PipelineRunner({});
    const eventBus = new EventBus();
    const hm = new HookManager(eventBus);
    const orchestrator = new LoopOrchestrator(runner, hm, store as unknown as CheckpointStore<ReturnType<typeof serialize>>);

    runner.register({ stage: 'processInput', execute: async () => {} });
    runner.register({ stage: 'buildContext', execute: async () => {} });
    runner.register({ stage: 'prepareStep', execute: async () => {} });
    runner.register({
      stage: 'invokeLLM',
      execute: async (pCtx: ProcessorContext) => { pCtx.state.iteration.response = 'done'; },
    });
    runner.register({ stage: 'processStepOutput', execute: async () => {} });
    runner.register({ stage: 'executeTools', execute: async () => {} });
    runner.register({
      stage: 'evaluateIteration',
      execute: async (pCtx: ProcessorContext) => { pCtx.state.iteration.loopDirective = { action: 'stop' }; },
    });
    runner.register({ stage: 'processOutput', execute: async () => {} });

    const ctx: PipelineContext = {
      agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0 },
      session: { input: 'test', sessionId: 'no-auto-cp', custom: {} },
    };

    // Default: autoCheckpoint is false
    const options: LoopOptions = {
      maxIterations: 5,
      modelString: 'mock/test',
      sessionId: 'no-auto-cp',
    };

    await orchestrator.runLoop(ctx, options);

    expect(saveSpy).toHaveLength(0);
  });
});
