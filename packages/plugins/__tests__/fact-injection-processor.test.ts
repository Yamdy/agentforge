import { describe, it, expect } from 'vitest';
import { createFactInjectionProcessor } from '../src/harness/fact-injection-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '@primo-ai/core';

function makeContext(): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
  } as PipelineContext;
}

function makeProcessorContext(): ProcessorContext {
  return new ProcessorContextImpl(makeContext());
}

describe('FactInjectionProcessor', () => {
  it('injects static facts as promptFragment', async () => {
    const processor = createFactInjectionProcessor({
      facts: ['Always respond in English', 'Never mention pricing'],
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments).toHaveLength(1);
    expect(pCtx.state.agent.promptFragments[0]).toContain('Always respond in English');
    expect(pCtx.state.agent.promptFragments[0]).toContain('Never mention pricing');
    expect(pCtx.state.agent.promptFragments[0]).toContain('[Constraints & Facts]');
  });

  it('injects dynamic facts from function', async () => {
    const processor = createFactInjectionProcessor({
      facts: (ctx) => [`User input was: ${ctx.request.input}`],
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments[0]).toContain('User input was: test');
  });

  it('injects async dynamic facts', async () => {
    const processor = createFactInjectionProcessor({
      facts: async (ctx) => [`Async fact for ${ctx.request.sessionId}`],
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments[0]).toContain('Async fact for s1');
  });

  it('passes through with no injection for empty facts', async () => {
    const processor = createFactInjectionProcessor({ facts: [] });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments).toHaveLength(0);
  });

  it('appends to existing promptFragments', async () => {
    const processor = createFactInjectionProcessor({ facts: ['fact1'] });
    const pCtx = makeProcessorContext();
    pCtx.state.agent.promptFragments = ['existing fragment'];
    await processor.execute(pCtx);
    expect(pCtx.state.agent.promptFragments).toHaveLength(2);
    expect(pCtx.state.agent.promptFragments[0]).toBe('existing fragment');
    expect(pCtx.state.agent.promptFragments[1]).toContain('fact1');
  });
});
