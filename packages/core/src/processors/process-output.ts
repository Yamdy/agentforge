import type { Processor, ProcessorContext } from '@primo-ai/sdk';

export const processOutputProcessor: Processor = {
  stage: 'processOutput',
  execute: async (_pCtx: ProcessorContext) => {},
};
