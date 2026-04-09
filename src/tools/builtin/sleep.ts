import type { Tool } from '../../types.js';

export interface SleepToolArgs {
  milliseconds: number;
}

export const SleepTool: Tool = {
  name: 'sleep',
  description: 'Wait for a specified amount of time',
  parameters: {
    type: 'object',
    properties: {
      milliseconds: {
        type: 'number',
        description: 'Number of milliseconds to sleep',
      },
    },
    required: ['milliseconds'],
  },
  execute: async (args: Record<string, unknown>) => {
    const milliseconds = args.milliseconds as number;
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return `Slept for ${milliseconds}ms`;
  },
};
