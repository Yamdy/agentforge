import { describe, it, expect } from 'vitest';
import { createGoalEchoProcessor } from '../src/harness/goal-echo-processor.js';
import type { PipelineContext, ProcessorResult } from '@primo-ai/sdk';

function makeContext(step = 0): PipelineContext {
  return {
    request: { input: 'build a REST API', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step },
    session: { custom: {} },
  } as PipelineContext;
}

function isContext(r: ProcessorResult): r is PipelineContext {
  return 'request' in r && 'agent' in r;
}

describe('GoalEchoProcessor', () => {
  it('passes through when disabled', async () => {
    const processor = createGoalEchoProcessor({
      enabled: false,
      echoFrequency: 1,
      progressTracking: false,
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments).toHaveLength(0);
    }
  });

  it('echoes on step 0', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 1,
      progressTracking: false,
    });
    const result = await processor.execute(makeContext(0));
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments).toHaveLength(1);
      expect(result.agent.promptFragments[0]).toContain('build a REST API');
    }
  });

  it('echoes every N iterations', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 3,
      progressTracking: false,
    });

    const r0 = await processor.execute(makeContext(0));
    expect(isContext(r0) && r0.agent.promptFragments).toHaveLength(1);

    const r1ctx = makeContext(1);
    if (isContext(r0)) r1ctx.session.custom = r0.session.custom;
    const r1 = await processor.execute(r1ctx);
    expect(isContext(r1) && r1.agent.promptFragments).toHaveLength(0);

    const r3ctx = makeContext(3);
    if (isContext(r1)) r3ctx.session.custom = r1.session.custom;
    const r3 = await processor.execute(r3ctx);
    expect(isContext(r3) && r3.agent.promptFragments).toHaveLength(1);
  });

  it('includes progress assessment when enabled', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 1,
      progressTracking: true,
    });
    const result = await processor.execute(makeContext(0));
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.agent.promptFragments[0]).toContain('Progress Assessment');
    }
  });

  it('preserves original goal across iterations', async () => {
    const processor = createGoalEchoProcessor({
      enabled: true,
      echoFrequency: 1,
      progressTracking: false,
    });
    const r0 = await processor.execute(makeContext(0));
    expect(isContext(r0) && r0.agent.promptFragments[0]).toContain('build a REST API');

    const ctx2 = makeContext(1);
    ctx2.request.input = 'something different';
    if (isContext(r0)) ctx2.session.custom = r0.session.custom;
    const r1 = await processor.execute(ctx2);
    expect(isContext(r1) && r1.agent.promptFragments[0]).toContain('build a REST API');
  });
});
