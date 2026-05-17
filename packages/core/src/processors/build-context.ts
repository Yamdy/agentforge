import type { Processor } from '@primo-ai/sdk';

export const buildContextExtensionPoint: Processor = {
  stage: 'buildContext',
  execute: async (ctx) => ctx,
};
