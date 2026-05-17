import type { Processor } from '@primo-ai/sdk';

export const prepareStepExtensionPoint: Processor = {
  stage: 'prepareStep',
  execute: async (ctx) => ctx,
};
