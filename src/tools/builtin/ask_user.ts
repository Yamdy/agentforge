import { Tool } from '../../types';

interface AskUserToolArgs {
  question: string;
}

export const AskUserTool: Tool = {
  name: 'ask_user',
  description:
    'Ask the user a question and get their response. Use this when you need clarification or additional information.',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
    },
    required: ['question'],
  },
  async execute(args: Record<string, unknown>) {
    const parsed = args as unknown as AskUserToolArgs;
    // This tool signals that the agent needs user input
    // The actual interaction is handled by the runtime
    return `[Requesting user input]\nQuestion: ${parsed.question}`;
  },
};
