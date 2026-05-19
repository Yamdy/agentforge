import type { Processor, ProcessorContext } from '@primo-ai/sdk';

export const buildContextExtensionPoint: Processor = {
  stage: 'buildContext',
  execute: async (_pCtx: ProcessorContext) => {},
};
