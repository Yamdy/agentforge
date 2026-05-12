import type { Processor, LoopDirective } from '@agentforge/sdk';

export const evaluateIterationProcessor: Processor = {
  stage: 'evaluateIteration',
  execute: async (ctx) => {
    const totalTokens = (ctx.session.totalTokenUsage?.input ?? 0) + (ctx.session.totalTokenUsage?.output ?? 0)
      + (ctx.iteration.tokenUsage?.input ?? 0) + (ctx.iteration.tokenUsage?.output ?? 0);

    if (totalTokens > 100_000) {
      ctx.iteration.span?.setAttribute('token.overflow', true);
      return {
        ...ctx,
        iteration: {
          ...ctx.iteration,
          loopDirective: { action: 'stop' } as LoopDirective,
        },
      };
    }

    const hasToolCalls = (ctx.iteration.toolResults?.length ?? 0) > 0;

    const directive: LoopDirective = hasToolCalls
      ? { action: 'continue' }
      : { action: 'stop' };

    return {
      ...ctx,
      iteration: {
        ...ctx.iteration,
        loopDirective: directive,
      },
    };
  },
};
