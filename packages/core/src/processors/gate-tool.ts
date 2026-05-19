import type { Processor, ProcessorContext } from '@primo-ai/sdk';

export const gateToolExtensionPoint: Processor = {
  stage: 'gateTool',
  execute: async (_pCtx: ProcessorContext) => {},
  isNoOp: true,
};
