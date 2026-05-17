import type { Processor } from '@primo-ai/sdk';

export const processOutputProcessor: Processor = {
  stage: 'processOutput',
  execute: async (ctx) => ctx,
};
