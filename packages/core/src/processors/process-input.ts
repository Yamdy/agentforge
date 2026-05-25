import type { Processor, ProcessorContext, ProcessorResult, Dynamic, ResolveContext } from '@primo-ai/sdk';
import { resolveDynamic } from '../dynamic-resolver.js';

export const processInputProcessor: Processor = {
  stage: 'processInput',
  execute: async (pCtx: ProcessorContext): Promise<ProcessorResult> => {
    const ctx = pCtx.state;
    const resolveCtx: ResolveContext = {
      input: ctx.session.input,
      sessionId: ctx.session.sessionId,
      metadata: {},
    };
    const config = { ...ctx.agent.config };
    const resolved: string[] = [];
    if (config.systemPrompt != null) {
      config.systemPrompt = await resolveDynamic<string>(config.systemPrompt as Dynamic<string>, resolveCtx);
      resolved.push('systemPrompt');
    }
    if (config.maxIterations != null) {
      config.maxIterations = await resolveDynamic<number>(config.maxIterations as Dynamic<number>, resolveCtx);
      resolved.push('maxIterations');
    }
    ctx.agent.config = config;

    return {
      status: 'success',
      summary: `Resolved dynamic config: ${resolved.join(', ') || 'no changes'}`,
      nextActions: resolved.length > 0 ? ['buildContext'] : undefined,
    };
  },
};
