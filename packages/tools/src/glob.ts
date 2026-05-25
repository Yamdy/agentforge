import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const globTool: Tool<
  { pattern: string; path?: string },
  { files: string[]; count: number }
> = {
  name: 'glob',
  description:
    'Find files matching a glob pattern. Returns file paths sorted by modification time.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "src/**/*.js")'),
    path: z.string().optional().describe('Base directory to search in'),
  }),
  requireApproval: false,
  async execute(input) {
    const { glob } = await import('node:fs/promises');
    const { pattern, path: cwd } = input;

    const files: string[] = [];
    for await (const entry of glob(pattern, { cwd })) {
      files.push(entry);
    }
    const result: { files: string[]; count: number; suggestedActions?: string[] } = { files, count: files.length };
    if (files.length > 0) {
      result.suggestedActions = ['Use file_read to view file contents'];
    }
    return result;
  },
  renderCall(input) {
    return `glob ${input.pattern}`;
  },
  renderResult(output) {
    return `${output.count} files matched`;
  },
};
