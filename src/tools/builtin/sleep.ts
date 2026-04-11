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

    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error(`Invalid sleep duration: ${milliseconds}. Must be a non-negative finite number.`);
    }

    const MAX_SLEEP = 300000;
    const duration = Math.min(milliseconds, MAX_SLEEP);

    await new Promise((resolve) => setTimeout(resolve, duration));
    return `Slept for ${duration}ms`;
  },
};
