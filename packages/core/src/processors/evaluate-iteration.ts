import type { Processor, LoopDirective, TokenUsage } from '@agentforge/sdk';

export const evaluateIterationProcessor: Processor = {
  stage: 'evaluateIteration',
  execute: async (ctx) => {
    const prevTotal = ctx.session.totalTokenUsage ?? { input: 0, output: 0 };
    const iterUsage = ctx.iteration.tokenUsage ?? { input: 0, output: 0 };
    const totalTokenUsage: TokenUsage = {
      input: prevTotal.input + iterUsage.input,
      output: prevTotal.output + iterUsage.output,
    };

    const totalTokens = totalTokenUsage.input + totalTokenUsage.output;

    if (totalTokens > 100_000) {
      ctx.iteration.span?.setAttribute('token.overflow', true);
      ctx.iteration.span?.setAttribute('token.total', totalTokens);
      return {
        ...ctx,
        iteration: {
          ...ctx.iteration,
          loopDirective: { action: 'stop' } as LoopDirective,
        },
        session: {
          ...ctx.session,
          totalTokenUsage,
        },
      };
    }

    const hasToolResults = (ctx.iteration.toolResults?.length ?? 0) > 0;
    const directive: LoopDirective = hasToolResults
      ? { action: 'continue' }
      : { action: 'stop' };

    return {
      ...ctx,
      iteration: {
        ...ctx.iteration,
        loopDirective: directive,
      },
      session: {
        ...ctx.session,
        totalTokenUsage,
      },
    };
  },
};
