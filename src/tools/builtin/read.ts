import { Tool } from '../../types';
import { existsSync, statSync } from 'fs';
import { join, isAbsolute } from 'path';
import { createInterface } from 'readline';
import { createReadStream } from 'fs';

interface ReadToolArgs {
  filePath: string;
  offset?: number;
  limit?: number;
}

export const ReadTool: Tool = {
  name: 'read',
  description:
    'Read a file or directory from the local filesystem. If the path does not exist, an error is returned.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The absolute path to the file or directory to read',
      },
      offset: {
        type: 'number',
        description: 'The line number to start reading from (1-indexed)',
        optional: true,
      },
      limit: {
        type: 'number',
        description: 'The maximum number of lines to read (defaults to 2000)',
        optional: true,
      },
    },
    required: ['filePath'],
  },
  async execute(args: Record<string, unknown>) {
    const DEFAULT_READ_LIMIT = 2000;
    const MAX_LINE_LENGTH = 2000;
    const MAX_BYTES = 50 * 1024;

    const parsed = args as unknown as ReadToolArgs;
    let filepath = parsed.filePath;
    if (!isAbsolute(filepath)) {
      filepath = join(process.cwd(), filepath);
    }

    if (!existsSync(filepath)) {
      return `File not found: ${filepath}`;
    }

    const stats = statSync(filepath);

    if (stats.isDirectory()) {
      return readDirectory(filepath, parsed.offset, parsed.limit);
    } else {
      return readFile(filepath, parsed.offset, parsed.limit);
    }

    async function readDirectory(
      dirPath: string,
      offset: number = 1,
      limit: number = DEFAULT_READ_LIMIT
    ) {
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

      const start = offset - 1;
      const end = start + limit;
      const sliced = fileEntries.slice(start, end);
      const truncated = end < fileEntries.length;

      let output = `<path>${dirPath}</path>\n<type>directory</type>\n<entries>\n${sliced.join('\n')}`;

      if (truncated) {
        output += `\n\n(Showing ${sliced.length} of ${fileEntries.length} entries. Use offset=${end + 1} to continue.)`;
      } else {
        output += `\n\n(${fileEntries.length} entries)`;
      }

      output += '\n</entries>';

      return output;
    }

    async function readFile(
      filePath: string,
      offset: number = 1,
      limit: number = DEFAULT_READ_LIMIT
    ) {
      const stream = createReadStream(filePath, { encoding: 'utf8' });
      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      const lines: string[] = [];
      let byteCount = 0;

      for await (const text of rl) {
        const line =
          text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + '...' : text;
        const size = Buffer.byteLength(line, 'utf8') + 1;

        if (byteCount + size > MAX_BYTES) {
          break;
        }

        lines.push(line);
        byteCount += size;
      }

      rl.close();
      stream.destroy();

      const start = offset - 1;
      const end = start + limit;
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

      return output;
    }
  },
};
