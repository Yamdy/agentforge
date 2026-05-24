import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';

// ========== Zod Parameter Schema ==========

const AskUserParams = z.object({
  question: z.string().describe('The question to ask the user'),
});

type AskUserParamsType = z.infer<typeof AskUserParams>;

// ========== Metadata Interface ==========

interface AskUserMetadata {
  question: string;
  answer?: string;
}

// ========== Tool Implementation ==========

export const AskUserTool: Tool<AskUserParamsType, AskUserMetadata> = {
  name: 'ask_user',
  description:
    'Ask the user a question and get their response. Use this when you need clarification or additional information.',
  parameters: AskUserParams,

  async execute(
    args: AskUserParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<AskUserMetadata>> {
    const { question } = args;

    ctx.metadata({ title: `Asking user: ${question.slice(0, 30)}...` });

    // Use the context's ask() method to get actual user input
    const answer = await ctx.ask({
      message: question,
      allowCustom: true,
    });

    return {
      title: `User response: ${answer.choice.slice(0, 50)}`,
      output: `Question: ${question}\nAnswer: ${answer.choice}${answer.isCustom ? ' (custom)' : ''}`,
      metadata: {
        question,
        answer: answer.choice,
      },
    };
  },
};