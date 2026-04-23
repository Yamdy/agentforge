import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { existsSync, statSync } from 'fs';
import { join, isAbsolute } from 'path';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

// ========== Zod Parameter Schema ==========

const ReadParams = z.object({
  filePath: z.string().describe('The absolute path to the file or directory to read'),
  offset: z.number().optional().describe('The line number to start reading from (1-indexed)'),
  limit: z.number().optional().describe('The maximum number of lines to read (defaults to 2000)'),
});

type ReadParamsType = z.infer<typeof ReadParams>;

// ========== Metadata Interface ==========

interface ReadMetadata {
  path: string;
  type: 'file' | 'directory';
  lines?: number;
  entries?: number;
  size?: number;
}

// ========== Tool Implementation ==========

export const ReadTool: Tool<ReadParamsType, ReadMetadata> = {
  name: 'read',
  description:
    'Read a file or directory from the local filesystem. If the path does not exist, an error is returned.',
  parameters: ReadParams,
  permission: {
    category: 'read',
    extractInput: (args) => (args as ReadParamsType).filePath,
  },

  async execute(
    args: ReadParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<ReadMetadata>> {
    const DEFAULT_READ_LIMIT = 2000;
    const MAX_LINE_LENGTH = 2000;
    const MAX_BYTES = 50 * 1024;

    let filepath = args.filePath;
    if (!isAbsolute(filepath)) {
      filepath = join(process.cwd(), filepath);
    }

    if (!existsSync(filepath)) {
      return {
        title: 'Error',
        output: `File not found: ${filepath}`,
        metadata: { path: filepath, type: 'file' },
      };
    }

    const stats = statSync(filepath);

    if (stats.isDirectory()) {
      return readDirectory(filepath, args.offset, args.limit, DEFAULT_READ_LIMIT);
    } else {
      ctx.metadata({ title: `Reading ${filepath}...` });
      return readFile(filepath, args.offset, args.limit, DEFAULT_READ_LIMIT, MAX_LINE_LENGTH, MAX_BYTES);
    }
  },
};

// ========== Helper Functions ==========

async function readDirectory(
  dirPath: string,
  offset: number = 1,
  limit: number | undefined,
  defaultLimit: number
): Promise<ToolResult<ReadMetadata>> {
  const fs = await import('fs/promises');
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const fileEntries = entries
    .map((entry) => {
      if (entry.isDirectory()) {
        return entry.name + '/';
      }
      return entry.name;
    })
    .sort();

  const effectiveLimit = limit ?? defaultLimit;
  const start = offset - 1;
  const end = start + effectiveLimit;
  const sliced = fileEntries.slice(start, end);
  const truncated = end < fileEntries.length;

  let output = `<path>${dirPath}</path>\n<type>directory</type>\n<entries>\n${sliced.join('\n')}`;

  if (truncated) {
    output += `\n\n(Showing ${sliced.length} of ${fileEntries.length} entries. Use offset=${end + 1} to continue.)`;
  } else {
    output += `\n\n(${fileEntries.length} entries)`;
  }

  output += '\n</entries>';

  return {
    title: `Read ${dirPath} (${fileEntries.length} entries)`,
    output,
    metadata: {
      path: dirPath,
      type: 'directory',
      entries: fileEntries.length,
    },
  };
}

async function readFile(
  filePath: string,
  offset: number = 1,
  limit: number | undefined,
  defaultLimit: number,
  maxLineLength: number,
  maxBytes: number
): Promise<ToolResult<ReadMetadata>> {
  const effectiveLimit = limit ?? defaultLimit;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  let byteCount = 0;

  for await (const text of rl) {
    const line =
      text.length > maxLineLength ? text.substring(0, maxLineLength) + '...' : text;
    const size = Buffer.byteLength(line, 'utf8') + 1;

    if (byteCount + size > maxBytes) {
      break;
    }

    lines.push(line);
    byteCount += size;
  }

  rl.close();
  stream.destroy();

  const start = offset - 1;
  const end = start + effectiveLimit;
  const sliced = lines.slice(start, end);
  const truncated = end < lines.length;

  let output = `<path>${filePath}</path>\n<type>file</type>\n<content>`;

  for (let i = 0; i < sliced.length; i++) {
    output += `\n${i + offset}: ${sliced[i]}`;
  }

  if (truncated) {
    output += `\n\n(Showing lines ${offset}-${end - 1} of ${lines.length}. Use offset=${end} to continue.)`;
  } else {
    output += `\n\n(End of file - total ${lines.length} lines)`;
  }

  output += '\n</content>';

  return {
    title: `Read ${filePath} (${lines.length} lines)`,
    output,
    metadata: {
      path: filePath,
      type: 'file',
      lines: lines.length,
      size: byteCount,
    },
  };
}