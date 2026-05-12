import type { Processor } from '@agentforge/sdk';

export const processStepOutputProcessor: Processor = {
  stage: 'processStepOutput',
  execute: async (ctx) => ctx,
};
