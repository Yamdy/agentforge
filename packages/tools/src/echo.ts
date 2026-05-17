import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const echoTool: Tool<{ message: string }, string> = {
  name: 'echo',
  description: 'Returns the input message unchanged. Useful for testing.',
  inputSchema: z.object({ message: z.string() }),
  execute: async ({ message }) => message,
};
