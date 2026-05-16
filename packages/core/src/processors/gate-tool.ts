import type { Processor } from '@agentforge/sdk';

export const gateToolExtensionPoint: Processor = {
  stage: 'gateTool',
  execute: async (ctx) => ctx,
  isNoOp: true,
};
