import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const fileReadTool: Tool<
  { path: string; encoding?: string; offset?: number; limit?: number },
  { content: string; lines: number; path: string }
> = {
  name: 'fileRead',
  description:
    'Read file contents from the local filesystem. Supports line range via offset/limit.',
  inputSchema: z.object({
    path: z.string().describe('Absolute file path'),
    encoding: z
      .enum(['utf-8', 'ascii', 'base64', 'hex', 'latin1'])
      .optional()
      .default('utf-8')
      .describe('File encoding'),
    offset: z.number().optional().describe('Start line (1-indexed)'),
    limit: z.number().optional().describe('Max lines to read'),
  }),
  requireApproval: false,
  async execute(input) {
    const fs = await import('node:fs/promises');
    const { path, encoding = 'utf-8', offset, limit } = input;

    const raw = await fs.readFile(path, { encoding: encoding as BufferEncoding });
    if (offset == null && limit == null) {
      const lines = raw.split('\n').length;
      return { content: raw, lines, path };
    }

    const allLines = raw.split('\n');
    const start = (offset ?? 1) - 1;
    const end = limit != null ? start + limit : allLines.length;
    const sliced = allLines.slice(start, end);
    const numbered = sliced
      .map((line, i) => `${start + i + 1}\t${line}`)
      .join('\n');
    return { content: numbered, lines: allLines.length, path };
  },
  renderCall(input) {
    return `read ${input.path}`;
  },
  renderResult(output) {
    return `[${output.path}] ${output.lines} lines`;
  },
};
