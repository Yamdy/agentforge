import { describe, it, expect } from 'vitest';
import { createCostCapProcessor } from '../src/harness/cost-cap-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

function makeContext(step = 0, custom?: Record<string, unknown>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'gpt-4o' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step, tokenUsage: { input: 1000, output: 500 } },
    session: { custom: custom ?? {} },
  } as PipelineContext;
}

function makeProcessorContext(step = 0, custom?: Record<string, unknown>): ProcessorContext {
  return new ProcessorContextImpl(makeContext(step, custom));
}

async function expectAbort(pCtx: ProcessorContext, processor: { execute: (ctx: ProcessorContext) => Promise<unknown> }): Promise<string> {
  try {
    await processor.execute(pCtx);
    throw new Error('Expected abort but processor returned normally');
  } catch (error) {
    if (error instanceof AbortControlFlow) {
      return error.reason;
    }
    throw error;
  }
}

describe('CostCapProcessor', () => {
  const pricing = { 'gpt-4o': { input: 2.5, output: 10 } };

  it('allows when under budget', async () => {
    const processor = createCostCapProcessor({
      maxCost: 100,
      strategy: 'block',
      modelPricing: pricing,
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    // No abort = allowed
  });

  it('blocks when over budget with block strategy', async () => {
    const processor = createCostCapProcessor({
      maxCost: 0.0001,
      strategy: 'block',
      modelPricing: pricing,
    });
    const pCtx = makeProcessorContext();
    const reason = await expectAbort(pCtx, processor);
    expect(reason).toContain('Cost cap exceeded');
  });

  it('warns but continues with warn strategy', async () => {
    const processor = createCostCapProcessor({
      maxCost: 0.0001,
      strategy: 'warn',
      modelPricing: pricing,
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    // No abort = continued
  });

  it('accumulates cost across iterations', async () => {
    const processor = createCostCapProcessor({
      maxCost: 100,
      strategy: 'block',
      modelPricing: pricing,
    });

    const pCtx0 = makeProcessorContext(0);
    await processor.execute(pCtx0);
    const state0 = pCtx0.state.session.custom.costCap as { cumulativeCost: number };
    expect(state0.cumulativeCost).toBeGreaterThan(0);

    const pCtx1 = makeProcessorContext(1, { costCap: state0 });
    await processor.execute(pCtx1);
    const state1 = pCtx1.state.session.custom.costCap as { cumulativeCost: number };
    expect(state1.cumulativeCost).toBeGreaterThan(state0.cumulativeCost);
  });

  it('defaults to $0 for unknown models', async () => {
    const processor = createCostCapProcessor({
      maxCost: 0.000001,
      strategy: 'block',
      modelPricing: pricing,
    });
    const pCtx = makeProcessorContext();
    pCtx.state.agent.config.model = 'unknown-model';
    await processor.execute(pCtx);
    // No abort = allowed (unknown model has $0 cost)
  });

  it('stores iteration cost records', async () => {
    const processor = createCostCapProcessor({
      maxCost: 100,
      strategy: 'block',
      modelPricing: pricing,
    });
    const pCtx = makeProcessorContext(0);
    await processor.execute(pCtx);
    const state = pCtx.state.session.custom.costCap as { iterations: Array<{ step: number; cost: number }> };
    expect(state.iterations).toHaveLength(1);
    expect(state.iterations[0].step).toBe(0);
    expect(state.iterations[0].cost).toBeGreaterThan(0);
  });
});
