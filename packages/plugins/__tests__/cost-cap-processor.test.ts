import { describe, it, expect } from 'vitest';
import { createCostCapProcessor } from '../src/harness/cost-cap-processor.js';
import type { PipelineContext, ProcessorResult } from '@primo-ai/sdk';

function makeContext(step = 0, custom?: Record<string, unknown>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'gpt-4o' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step, tokenUsage: { input: 1000, output: 500 } },
    session: { custom: custom ?? {} },
  } as PipelineContext;
}

function isAbort(r: ProcessorResult): r is { type: 'abort'; reason: string } {
  return 'type' in r && r.type === 'abort';
}

function isContext(r: ProcessorResult): r is PipelineContext {
  return 'request' in r && 'agent' in r;
}

describe('CostCapProcessor', () => {
  const pricing = { 'gpt-4o': { input: 2.5, output: 10 } };

  it('allows when under budget', async () => {
    const processor = createCostCapProcessor({
      maxCost: 100,
      strategy: 'block',
      modelPricing: pricing,
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
  });

  it('blocks when over budget with block strategy', async () => {
    const processor = createCostCapProcessor({
      maxCost: 0.0001,
      strategy: 'block',
      modelPricing: pricing,
    });
    const result = await processor.execute(makeContext());
    expect(isAbort(result)).toBe(true);
    if (isAbort(result)) {
      expect(result.reason).toContain('Cost cap exceeded');
    }
  });

  it('warns but continues with warn strategy', async () => {
    const processor = createCostCapProcessor({
      maxCost: 0.0001,
      strategy: 'warn',
      modelPricing: pricing,
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
  });

  it('accumulates cost across iterations', async () => {
    const processor = createCostCapProcessor({
      maxCost: 100,
      strategy: 'block',
      modelPricing: pricing,
    });

    const r0 = await processor.execute(makeContext(0));
    expect(isContext(r0)).toBe(true);
    const state0 = (r0 as PipelineContext).session.custom.costCap as { cumulativeCost: number };
    expect(state0.cumulativeCost).toBeGreaterThan(0);

    const r1 = await processor.execute(makeContext(1, { costCap: state0 }));
    expect(isContext(r1)).toBe(true);
    const state1 = (r1 as PipelineContext).session.custom.costCap as { cumulativeCost: number };
    expect(state1.cumulativeCost).toBeGreaterThan(state0.cumulativeCost);
  });

  it('defaults to $0 for unknown models', async () => {
    const processor = createCostCapProcessor({
      maxCost: 0.000001,
      strategy: 'block',
      modelPricing: pricing,
    });
    const ctx = makeContext();
    ctx.agent.config.model = 'unknown-model';
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
  });

  it('stores iteration cost records', async () => {
    const processor = createCostCapProcessor({
      maxCost: 100,
      strategy: 'block',
      modelPricing: pricing,
    });
    const result = await processor.execute(makeContext(0));
    expect(isContext(result)).toBe(true);
    const state = (result as PipelineContext).session.custom.costCap as { iterations: Array<{ step: number; cost: number }> };
    expect(state.iterations).toHaveLength(1);
    expect(state.iterations[0].step).toBe(0);
    expect(state.iterations[0].cost).toBeGreaterThan(0);
  });
});
