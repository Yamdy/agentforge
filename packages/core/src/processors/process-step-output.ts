import type { Processor, Message } from '@primo-ai/sdk';
import { textContentFromBlocks, toolCallsFromBlocks, reasoningFromBlocks } from '../content-blocks.js';

export const processStepOutputProcessor: Processor = {
  stage: 'processStepOutput',
  execute: async (ctx) => {
    // Prefer content[] when available, fallback to legacy fields
    const content = ctx.iteration.content;
    const response = content
      ? textContentFromBlocks(content)
      : ctx.iteration.response ?? '';
    const toolCalls = content
      ? toolCallsFromBlocks(content)
      : ctx.iteration.pendingToolCalls;
    const reasoningContent = content
      ? reasoningFromBlocks(content)
      : ctx.iteration.reasoningContent;

    const assistantMsg: Message = {
      role: 'assistant',
      content: response,
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(reasoningContent ? { reasoningContent } : {}),
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
