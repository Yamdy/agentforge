import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, isAbsolute } from 'path';

// ========== Zod Parameter Schema ==========

const LsParams = z.object({
  directory: z
    .string()
    .optional()
    .describe('The directory path to list. Defaults to current working directory.'),
});

type LsParamsType = z.infer<typeof LsParams>;

// ========== Metadata Interface ==========

interface LsMetadata {
  path: string;
  entryCount: number;
  directories: number;
  files: number;
}

// ========== Tool Implementation ==========

export const LsTool: Tool<LsParamsType, LsMetadata> = {
  name: 'ls',
  description:
    'List files in a directory. If no path is specified, lists the current working directory.',
  parameters: LsParams,

  async execute(
    args: LsParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<LsMetadata>> {
    const directory = args.directory || process.cwd();
    let dirPath = directory;
    if (!isAbsolute(dirPath)) {
      dirPath = join(process.cwd(), dirPath);
    }

    if (!existsSync(dirPath)) {
      return {
        title: 'Error',
        output: `Directory not found: ${dirPath}`,
        metadata: { path: dirPath, entryCount: 0, directories: 0, files: 0 },
      };
    }

    const stats = statSync(dirPath);
    if (!stats.isDirectory()) {
      return {
        title: 'Error',
        output: `Not a directory: ${dirPath}`,
        metadata: { path: dirPath, entryCount: 0, directories: 0, files: 0 },
      };
    }

    ctx.metadata({ title: `Listing ${dirPath}...` });

    let dirCount = 0;
    let fileCount = 0;

    const files = readdirSync(dirPath)
      .map((file) => {
        const fullPath = join(dirPath, file);
        const fileStats = statSync(fullPath);
        if (fileStats.isDirectory()) {
          dirCount++;
          return `${file}/`;
        }
        fileCount++;
        return file;
      })
      .sort();

    return {
      title: `${dirPath} (${files.length} entries)`,
      output: files.join('\n'),
      metadata: {
        path: dirPath,
        entryCount: files.length,
        directories: dirCount,
        files: fileCount,
      },
    };
  },
};