import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import type { Processor, PipelineContext, ProcessorContext } from '@primo-ai/sdk';

function makeP(stage: string, name: string, priority?: number, shouldAbort?: { reason: string }): Processor {
  return {
    stage,
    priority,
    execute: async (_ctx: ProcessorContext) => {
      if (shouldAbort) {
        _ctx.control.abort(shouldAbort.reason);
      }
      const state = _ctx.state;
      if (!state.session.custom._visited) {
        state.session.custom._visited = [];
      }
      (state.session.custom._visited as string[]).push(name);
    },
  };
}

function makeCtx(): PipelineContext {
  return {
    agent: { config: { model: 'test/gpt-4' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 'prio-test', custom: {} },
  };
}

describe('PipelineRunner — processor priority ordering', () => {
  it('executes processors in priority-descending order within the same stage', async () => {
    const runner = new PipelineRunner();
    runner.register(makeP('prepareStep', 'low', 50));
    runner.register(makeP('prepareStep', 'high', 200));
    runner.register(makeP('prepareStep', 'mid', 100));

    const ctx = makeCtx();
    let lastCtx: PipelineContext = ctx;
    for await (const event of runner.stream(ctx, ['prepareStep'])) {
      if (event.type === 'complete') {
        lastCtx = event.context;
      }
    }

    const visited = lastCtx.session.custom._visited as string[];
    expect(visited).toEqual(['high', 'mid', 'low']);
  });

  it('default priority of 100 for processors without explicit priority', async () => {
    const runner = new PipelineRunner();
    runner.register(makeP('prepareStep', 'explicit-200', 200));
    runner.register(makeP('prepareStep', 'implicit-default'));

    const ctx = makeCtx();
    let lastCtx: PipelineContext = ctx;
    for await (const event of runner.stream(ctx, ['prepareStep'])) {
      if (event.type === 'complete') {
        lastCtx = event.context;
      }
    }

    const visited = lastCtx.session.custom._visited as string[];
    expect(visited).toEqual(['explicit-200', 'implicit-default']);
  });

  it('maintains insertion order for same priority', async () => {
    const runner = new PipelineRunner();
    runner.register(makeP('prepareStep', 'first', 100));
    runner.register(makeP('prepareStep', 'second', 100));
    runner.register(makeP('prepareStep', 'third', 100));

    const ctx = makeCtx();
    let lastCtx: PipelineContext = ctx;
    for await (const event of runner.stream(ctx, ['prepareStep'])) {
      if (event.type === 'complete') {
        lastCtx = event.context;
      }
    }

    const visited = lastCtx.session.custom._visited as string[];
    expect(visited).toEqual(['first', 'second', 'third']);
  });

  it('high-priority abort prevents lower-priority execution', async () => {
    const runner = new PipelineRunner();
    let lowExecuted = false;
    const highAborter: Processor = {
      stage: 'prepareStep',
      priority: 200,
      execute: async (pCtx: ProcessorContext) => {
        pCtx.control.abort('blocked by high priority');
      },
    };
    const lowNoop: Processor = {
      stage: 'prepareStep',
      priority: 50,
      execute: async () => {
        lowExecuted = true;
      },
    };

    runner.register(lowNoop);
    runner.register(highAborter);

    const ctx = makeCtx();
    for await (const event of runner.stream(ctx, ['prepareStep'])) {
      // just consume
    }

    expect(lowExecuted).toBe(false);
  });
});
