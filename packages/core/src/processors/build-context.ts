import type { Processor } from '@agentforge/sdk';
import type { ToolRegistry } from '../tool-registry.js';

export function createBuildContextProcessor(registry: ToolRegistry): Processor {
  return {
    stage: 'buildContext',
    execute: async (ctx) => ({
      ...ctx,
      agent: {
        ...ctx.agent,
        systemPrompt: ctx.agent.config.systemPrompt as string | undefined,
        toolDeclarations: registry.getAll().map(t => ({
          name: t.name,
          description: t.description,
        })),
        providerOptions: ctx.agent.config.providerOptions,
      },
    }),
  };
}
