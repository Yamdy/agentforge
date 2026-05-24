import type { Processor, ProcessorContext, Dynamic, ResolveContext } from '@primo-ai/sdk';
import { resolveDynamic } from '../dynamic-resolver.js';

export const processInputProcessor: Processor = {
  stage: 'processInput',
  execute: async (pCtx: ProcessorContext) => {
    const ctx = pCtx.state;
    const resolveCtx: ResolveContext = {
      input: ctx.session.input,
      sessionId: ctx.session.sessionId,
      metadata: {},
    };
    const config = { ...ctx.agent.config };
    if (config.systemPrompt != null) {
      config.systemPrompt = await resolveDynamic<string>(config.systemPrompt as Dynamic<string>, resolveCtx);
    }
    if (config.maxIterations != null) {
      config.maxIterations = await resolveDynamic<number>(config.maxIterations as Dynamic<number>, resolveCtx);
    }
    ctx.agent.config = config;
  },
};
