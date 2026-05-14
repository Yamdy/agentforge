import type { Processor } from '@agentforge/sdk';

export const prepareStepExtensionPoint: Processor = {
  stage: 'prepareStep',
  execute: async (ctx) => ctx,
};
