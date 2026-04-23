import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, isAbsolute, dirname } from 'path';

// ========== Zod Parameter Schema ==========

const WriteParams = z.object({
  content: z.string().describe('The content to write to the file'),
  filePath: z.string().describe('The absolute path to the file to write'),
});

type WriteParamsType = z.infer<typeof WriteParams>;

// ========== Metadata Interface ==========

interface WriteMetadata {
  path: string;
  bytes: number;
  created: boolean;
}

// ========== Tool Implementation ==========

export const WriteTool: Tool<WriteParamsType, WriteMetadata> = {
  name: 'write',
  description:
    'Writes a file to the local filesystem. If the directory does not exist, it will be created.',
  parameters: WriteParams,
  permission: {
    category: 'edit',
    extractInput: (args) => (args as WriteParamsType).filePath,
  },

  async execute(
    args: WriteParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<WriteMetadata>> {
    const { content, filePath: rawPath } = args;

    let filepath = rawPath;
    if (!isAbsolute(filepath)) {
      filepath = join(process.cwd(), filepath);
    }

    ctx.metadata({ title: `Writing ${filepath}...` });

    // Create directory if it doesn't exist
    const dir = dirname(filepath);
    const dirExisted = existsSync(dir);
    if (!dirExisted) {
      mkdirSync(dir, { recursive: true });
    }

    const fileExisted = existsSync(filepath);
    writeFileSync(filepath, content);

    const bytes = Buffer.byteLength(content, 'utf8');

    return {
      title: `File written: ${filepath}`,
      output: `File written successfully: ${filepath}`,
      metadata: {
        path: filepath,
        bytes,
        created: !fileExisted,
      },
    };
  },
};