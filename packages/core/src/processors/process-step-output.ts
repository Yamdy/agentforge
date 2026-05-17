import type { Processor, Message } from '@primo-ai/sdk';

export const processStepOutputProcessor: Processor = {
  stage: 'processStepOutput',
  execute: async (ctx) => {
    const response = ctx.iteration.response ?? '';
    const toolCalls = ctx.iteration.pendingToolCalls;

    const assistantMsg: Message = {
      role: 'assistant',
      content: response,
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(ctx.iteration.reasoningContent ? { reasoningContent: ctx.iteration.reasoningContent } : {}),
    };

    const history: Message[] = [...(ctx.session.messageHistory ?? [])];
    if (ctx.iteration.step === 0) {
      history.push({ role: 'user', content: ctx.request.input });
    }
    history.push(assistantMsg);

    return {
      ...ctx,
      session: { ...ctx.session, messageHistory: history },
    };
  },
};
