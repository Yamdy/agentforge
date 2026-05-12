import type { Processor, Dynamic, ResolveContext } from '@agentforge/sdk';
import { resolveDynamic } from '../dynamic-resolver.js';

export const processInputProcessor: Processor = {
  stage: 'processInput',
  execute: async (ctx) => {
    const resolveCtx: ResolveContext = {
      input: ctx.request.input,
      sessionId: ctx.request.sessionId,
      metadata: {},
    };
    const config = { ...ctx.agent.config };
    if (config.systemPrompt != null) {
      config.systemPrompt = await resolveDynamic<string>(config.systemPrompt as Dynamic<string>, resolveCtx);
    }
    if (config.maxIterations != null) {
      config.maxIterations = await resolveDynamic<number>(config.maxIterations as Dynamic<number>, resolveCtx);
    }
    return { ...ctx, agent: { ...ctx.agent, config } };
  },
};
