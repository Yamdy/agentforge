import type { Processor } from '@agentforge/sdk';

export const buildContextExtensionPoint: Processor = {
  stage: 'buildContext',
  execute: async (ctx) => ctx,
};
