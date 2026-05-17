import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const fileWriteTool: Tool<
  { path: string; content: string; encoding?: string; append?: boolean },
  { path: string; bytes: number }
> = {
  name: 'fileWrite',
  description:
    'Write content to a file on the local filesystem. Creates parent directories if needed.',
  inputSchema: z.object({
    path: z.string().describe('Absolute file path'),
    content: z.string().describe('Content to write'),
    encoding: z
      .enum(['utf-8', 'ascii', 'base64', 'hex', 'latin1'])
      .optional()
      .default('utf-8')
      .describe('File encoding'),
    append: z
      .boolean()
      .optional()
      .default(false)
      .describe('Append to file instead of overwriting'),
  }),
  requireApproval: true,
  async execute(input) {
    const fs = await import('node:fs/promises');
    const pathModule = await import('node:path');
    const { path, content, encoding = 'utf-8', append = false } = input;

    await fs.mkdir(pathModule.dirname(path), { recursive: true });

    const flag = append ? 'a' : 'w';
    await fs.writeFile(path, content, { encoding: encoding as BufferEncoding, flag });
    const bytes = Buffer.byteLength(content, encoding as BufferEncoding);
    return { path, bytes };
  },
  renderCall(input) {
    return `${input.append ? 'append' : 'write'} ${input.path} (${input.content.length} chars)`;
  },
  renderResult(output) {
    return `${output.path} (${output.bytes} bytes)`;
  },
};
