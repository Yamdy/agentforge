import { Tool } from '../../types';
import { readdirSync, statSync, existsSync } from 'fs';
import { join, isAbsolute } from 'path';

export const LsTool: Tool = {
  name: 'ls',
  description:
    'List files in a directory. If no path is specified, lists the current working directory.',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'The directory path to list. Defaults to current working directory.',
        optional: true,
      },
    },
    required: [],
  },
  async execute(args: any) {
    const directory = args.directory || process.cwd();
    let dirPath = directory;
    if (!isAbsolute(dirPath)) {
      dirPath = join(process.cwd(), dirPath);
    }

    if (!existsSync(dirPath)) {
      return `Directory not found: ${dirPath}`;
    }

    const stats = statSync(dirPath);
    if (!stats.isDirectory()) {
      return `Not a directory: ${dirPath}`;
    }

    const files = readdirSync(dirPath)
      .map((file) => {
        const fullPath = join(dirPath, file);
        const fileStats = statSync(fullPath);
        return fileStats.isDirectory() ? `${file}/` : file;
      })
      .sort();

    return files.join('\n');
  },
};
