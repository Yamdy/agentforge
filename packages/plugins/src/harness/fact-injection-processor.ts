import { z } from 'zod';
import type { Processor, PipelineContext, ProcessorResult } from '@primo-ai/sdk';
import { SpanAttributeKeys, SpanType } from '@primo-ai/sdk';

export interface FactInjectionConfig {
  facts: string[] | ((ctx: PipelineContext) => string[] | Promise<string[]>);
}

const FactInjectionConfigSchema = z.object({
  facts: z.union([z.array(z.string()), z.unknown()]),
});

export function createFactInjectionProcessor(config: FactInjectionConfig): Processor {
  FactInjectionConfigSchema.parse(config);
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
