import type { Processor } from '@primo-ai/sdk';

export const gateToolExtensionPoint: Processor = {
  stage: 'gateTool',
  execute: async (ctx) => ctx,
  isNoOp: true,
};
