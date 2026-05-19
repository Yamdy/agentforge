import type { Processor, ProcessorContext } from '@primo-ai/sdk';

export const prepareStepExtensionPoint: Processor = {
  stage: 'prepareStep',
  execute: async (pCtx: ProcessorContext) => {
    pCtx.state.iteration.toolResults = undefined;
    pCtx.state.iteration.pendingToolCalls = undefined;
  },
};
