import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const fileEditTool: Tool<
  { path: string; oldString: string; newString: string; replaceAll?: boolean },
  { path: string; replacements: number }
> = {
  name: 'fileEdit',
  description:
    'Perform exact string replacement in a file. Set replaceAll to replace all occurrences.',
  inputSchema: z.object({
    path: z.string().describe('Absolute file path'),
    oldString: z.string().describe('Exact string to find'),
    newString: z.string().describe('Replacement string'),
    replaceAll: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace all occurrences'),
  }),
  requireApproval: true,
  async execute(input) {
    const fs = await import('node:fs/promises');
    const { path, oldString, newString, replaceAll = false } = input;

    const content = await fs.readFile(path, 'utf-8');

    if (!content.includes(oldString)) {
      throw new Error(`String not found in ${path}`);
    }

    if (!replaceAll && content.split(oldString).length - 1 > 1) {
      throw new Error(
        `Multiple matches found in ${path}. Use replaceAll: true or provide more context.`,
      );
    }

    const updated = replaceAll
      ? content.replaceAll(oldString, newString)
      : content.replace(oldString, newString);

    await fs.writeFile(path, updated, 'utf-8');
    const replacements = replaceAll
      ? content.split(oldString).length - 1
      : 1;
    return { path, replacements };
  },
  renderCall(input) {
    return `edit ${input.path}: "${input.oldString.slice(0, 40)}..." → "${input.newString.slice(0, 40)}..."`;
  },
  renderResult(output) {
    return `${output.path} (${output.replacements} replacement(s))`;
  },
};
