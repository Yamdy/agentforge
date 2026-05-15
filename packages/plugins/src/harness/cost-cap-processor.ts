import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import { SpanAttributeKeys, SpanType } from '@agentforge/sdk';

export interface CostCapConfig {
  /** Maximum cumulative cost in dollars. */
  maxCost: number;
  /** What to do when cost exceeds budget. */
  strategy: 'block' | 'warn';
  /** Per-model pricing per 1M tokens. Keyed by model substring (e.g., 'gpt-4o'). */
  modelPricing?: Record<string, { input: number; output: number }>;
}

interface CostCapState {
  cumulativeCost: number;
  iterations: Array<{ step: number; cost: number }>;
}

const DEFAULT_PRICING = { input: 0, output: 0 };

function findPricing(model: string, pricing: Record<string, { input: number; output: number }> | undefined) {
  if (!pricing) return DEFAULT_PRICING;
  for (const [pattern, rates] of Object.entries(pricing)) {
    if (model.includes(pattern)) return rates;
  }
  return DEFAULT_PRICING;
}

export function createCostCapProcessor(config: CostCapConfig): Processor {
  return {
    stage: 'gateLLM',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      const state = (ctx.session.custom.costCap as CostCapState | undefined)
        ?? { cumulativeCost: 0, iterations: [] };

      const model = ctx.agent.config.model;
      const pricing = findPricing(model, config.modelPricing);

      const iterUsage = ctx.iteration.tokenUsage ?? { input: 0, output: 0 };
      const estimatedInput = iterUsage.input || Math.ceil((ctx.session.messageHistory ?? []).length * 50);
      const estimatedOutput = iterUsage.output || 2048;

      const estimatedStepCost =
        (estimatedInput / 1_000_000) * pricing.input
        + (estimatedOutput / 1_000_000) * pricing.output;

      const projectedCost = state.cumulativeCost + estimatedStepCost;

      const childSpan = ctx.iteration.span?.startChild(SpanType.COST_CAP_CHECK);
      childSpan?.setAttribute(SpanAttributeKeys.COST_ESTIMATED, estimatedStepCost);
      childSpan?.setAttribute(SpanAttributeKeys.COST_CUMULATIVE, state.cumulativeCost);
      childSpan?.setAttribute(SpanAttributeKeys.COST_BUDGET, config.maxCost);
      childSpan?.setAttribute(SpanAttributeKeys.MODEL_NAME, model);

      if (projectedCost > config.maxCost) {
        if (config.strategy === 'block') {
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'blocked');
          childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, `Cost cap exceeded: $${projectedCost.toFixed(4)} > $${config.maxCost}`);
          childSpan?.end();
          return {
            type: 'abort',
            reason: `Cost cap exceeded: projected $${projectedCost.toFixed(4)} exceeds budget $${config.maxCost}`,
          };
        }

        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'warned');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, `Cost approaching cap: $${projectedCost.toFixed(4)} / $${config.maxCost}`);
      } else {
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
      }

      childSpan?.end();

      const newState: CostCapState = {
        cumulativeCost: state.cumulativeCost + estimatedStepCost,
        iterations: [...state.iterations, { step: ctx.iteration.step, cost: estimatedStepCost }],
      };

      return {
        ...ctx,
        session: {
          ...ctx.session,
          custom: { ...ctx.session.custom, costCap: newState },
        },
      };
    },
  };
}
