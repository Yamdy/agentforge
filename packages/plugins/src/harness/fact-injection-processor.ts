import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import { SpanAttributeKeys, SpanType } from '@agentforge/sdk';

export interface FactInjectionConfig {
  facts: string[] | ((ctx: PipelineContext) => string[] | Promise<string[]>);
}

export function createFactInjectionProcessor(config: FactInjectionConfig): Processor {
  return {
    stage: 'buildContext',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      const resolvedFacts = typeof config.facts === 'function'
        ? await config.facts(ctx)
        : config.facts;

      if (resolvedFacts.length === 0) return ctx;

      const childSpan = ctx.iteration.span?.startChild(SpanType.FACT_INJECTION);
      childSpan?.setAttribute(SpanAttributeKeys.FACT_COUNT, resolvedFacts.length);

      const fragment = '[Constraints & Facts]\n'
        + resolvedFacts.map((f) => `- ${f}`).join('\n')
        + '\nThese facts are verified constraints. Do not contradict them.';

      childSpan?.end();

      return {
        ...ctx,
        agent: {
          ...ctx.agent,
          promptFragments: [...ctx.agent.promptFragments, fragment],
        },
      };
    },
  };
}
