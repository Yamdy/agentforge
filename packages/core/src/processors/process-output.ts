import type { Processor } from '@agentforge/sdk';

export const processOutputProcessor: Processor = {
  stage: 'processOutput',
  execute: async (ctx) => ctx,
};
