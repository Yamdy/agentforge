import type { PipelineContext, StageName } from '@primo-ai/sdk';

export interface HarnessDecision {
  processor: string;
  stage: StageName;
  decision: 'allow' | 'block' | 'warn' | 'queue';
  reason: string;
  timestamp: string;
}

export interface HarnessDecisionsBag {
  decisions: HarnessDecision[];
  active: boolean;
}

const BAG_NAMESPACE = '__harness_decisions';

function ensureBag(ctx: PipelineContext): HarnessDecisionsBag {
  if (!ctx.session.custom[BAG_NAMESPACE]) {
    ctx.session.custom[BAG_NAMESPACE] = { decisions: [], active: true };
  }
  return ctx.session.custom[BAG_NAMESPACE] as HarnessDecisionsBag;
}

export const HarnessDecisionRecorder = {
  ensure(ctx: PipelineContext): HarnessDecisionsBag {
    return ensureBag(ctx);
  },

  record(ctx: PipelineContext, decision: HarnessDecision): void {
    const bag = ensureBag(ctx);
    bag.decisions.push(decision);
  },

  isBlocked(ctx: PipelineContext): boolean {
    const bag = ctx.session.custom[BAG_NAMESPACE] as HarnessDecisionsBag | undefined;
    return bag?.decisions.some((d) => d.decision === 'block') ?? false;
  },

  getDecisions(ctx: PipelineContext): HarnessDecision[] {
    const bag = ctx.session.custom[BAG_NAMESPACE] as HarnessDecisionsBag | undefined;
    return bag?.decisions ?? [];
  },
};
