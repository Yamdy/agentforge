import type { Processor, ProcessorContext, ProcessorResult } from '@primo-ai/sdk';

export const prepareStepExtensionPoint: Processor = {
  stage: 'prepareStep',
  execute: async (pCtx: ProcessorContext): Promise<ProcessorResult> => {
    pCtx.state.iteration.toolResults = undefined;
    pCtx.state.iteration.pendingToolCalls = undefined;
    return {
      status: 'success',
      summary: 'Reset iteration state for new step',
    };
  },
};
