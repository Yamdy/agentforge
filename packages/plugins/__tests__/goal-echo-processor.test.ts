import { describe, it, expect } from 'vitest';
import { createGoalEchoProcessor } from '../src/harness/goal-echo-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '@primo-ai/core';

function makeContext(step = 0): PipelineContext {
  return {
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step },
    session: { input: 'build a REST API', sessionId: 's1', custom: {} },
  } as PipelineContext;
}

function makeProcessorContext(step = 0): ProcessorContext {
  return new ProcessorContextImpl(makeContext(step));
}

describe('GoalEchoProcessor', () => {
  it('passes through when disabled', async () => {
    const processor = createGoalEchoProcessor({
      enabled: false,
      echoFrequency: 1,
      progressTracking: false,
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments).toHaveLength(0);
  });

  it('echoes on step 0', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 1,
      progressTracking: false,
    });
    const pCtx = makeProcessorContext(0);
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments).toHaveLength(1);
    expect(pCtx.state.agent.promptFragments[0]).toContain('build a REST API');
  });

  it('echoes every N iterations', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 3,
      progressTracking: false,
    });

    const pCtx0 = makeProcessorContext(0);
    await processor.execute(pCtx0);
    expect(pCtx0.state.agent.promptFragments).toHaveLength(1);

    const pCtx1 = makeProcessorContext(1);
    pCtx1.state.session.custom = pCtx0.state.session.custom;
    await processor.execute(pCtx1);
    expect(pCtx1.state.agent.promptFragments).toHaveLength(0);

    const pCtx3 = makeProcessorContext(3);
    pCtx3.state.session.custom = pCtx1.state.session.custom;
    await processor.execute(pCtx3);
    expect(pCtx3.state.agent.promptFragments).toHaveLength(1);
  });

  it('includes progress assessment when enabled', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 1,
      progressTracking: true,
    });
    const pCtx = makeProcessorContext(0);
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments[0]).toContain('Progress Assessment');
  });

  it('preserves original goal across iterations', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 1,
      progressTracking: false,
    });
    const pCtx0 = makeProcessorContext(0);
    await processor.execute(pCtx0);
    expect(pCtx0.state.agent.promptFragments[0]).toContain('build a REST API');

    const pCtx1 = makeProcessorContext(1);
    pCtx1.state.session.input = 'something different';
    pCtx1.state.session.custom = pCtx0.state.session.custom;
    await processor.execute(pCtx1);
    expect(pCtx1.state.agent.promptFragments[0]).toContain('build a REST API');
  });
});
