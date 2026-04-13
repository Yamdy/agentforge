import { Tool } from '../../types';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, isAbsolute } from 'path';

interface FindToolArgs {
  path: string;
  name?: string;
  type?: 'file' | 'directory';
  maxDepth?: number;
}

export const FindTool: Tool = {
  name: 'find',
  description:
    'Recursively find files and directories by name pattern. Supports simple substring matching.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The starting directory for the search',
      },
      name: {
        type: 'string',
        description: 'Substring to match in filenames (e.g., "test", ".ts")',
        optional: true,
      },
      type: {
        type: 'string',
        description: 'Type of items to find: "file" or "directory" (default: both)',
        enum: ['file', 'directory'],
        optional: true,
      },
      maxDepth: {
        type: 'number',
        description: 'Maximum recursion depth (default: unlimited)',
        optional: true,
      },
    },
    required: ['path'],
  },
  async execute(args: Record<string, unknown>) {
    const parsed = args as unknown as FindToolArgs;
    let startPath = parsed.path;
    if (!isAbsolute(startPath)) {
      startPath = join(process.cwd(), startPath);
    }

    if (!existsSync(startPath)) {
      return `Path not found: ${startPath}`;
    }

    const results: string[] = [];

    function search(currentPath: string, currentDepth: number) {
      if (parsed.maxDepth && currentDepth > parsed.maxDepth) {
        return;
      }

      if (!existsSync(currentPath)) {
        return;
      }

      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        const fullPath = join(currentPath, entry);
        const stats = statSync(fullPath);
        const isDirectory = stats.isDirectory();

        // Check type filter
        if (parsed.type) {
          if (parsed.type === 'file' && isDirectory) continue;
          if (parsed.type === 'directory' && !isDirectory) continue;
        }

        // Check name filter
        if (!parsed.name || entry.includes(parsed.name)) {
          const relativePath = fullPath.replace(process.cwd() + '/', '');
          results.push(isDirectory ? `${relativePath}/` : relativePath);
        }

        // Recurse into directories
        if (isDirectory) {
          search(fullPath, currentDepth + 1);
        }
      }
    }

    search(startPath, 0);
    results.sort();

    if (results.length === 0) {
      return 'No matching files or directories found.';
    }

    return `${results.join('\n')}\n\nFound ${results.length} matches`;
  },
};
