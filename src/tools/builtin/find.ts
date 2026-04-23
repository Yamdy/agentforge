import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, isAbsolute } from 'path';

// ========== Zod Parameter Schema ==========

const FindParams = z.object({
  path: z.string().describe('The starting directory for the search'),
  name: z.string().optional().describe('Substring to match in filenames (e.g., "test", ".ts")'),
  type: z
    .enum(['file', 'directory'])
    .optional()
    .describe('Type of items to find: "file" or "directory" (default: both)'),
  maxDepth: z.number().optional().describe('Maximum recursion depth (default: unlimited)'),
});

type FindParamsType = z.infer<typeof FindParams>;

// ========== Metadata Interface ==========

interface FindMetadata {
  path: string;
  matchCount: number;
  truncated: boolean;
}

// ========== Tool Implementation ==========

export const FindTool: Tool<FindParamsType, FindMetadata> = {
  name: 'find',
  description:
    'Recursively find files and directories by name pattern. Supports simple substring matching.',
  parameters: FindParams,

  async execute(
    args: FindParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<FindMetadata>> {
    let startPath = args.path;
    if (!isAbsolute(startPath)) {
      startPath = join(process.cwd(), startPath);
    }

    if (!existsSync(startPath)) {
      return {
        title: 'Error',
        output: `Path not found: ${startPath}`,
        metadata: { path: startPath, matchCount: 0, truncated: false },
      };
    }

    ctx.metadata({ title: `Finding in ${startPath}...` });

    const results: string[] = [];
    const MAX_RESULTS = 5000;

    function search(currentPath: string, currentDepth: number): void {
      // Check abort signal
      if (ctx.abort.aborted) {
        return;
      }

      if (args.maxDepth && currentDepth > args.maxDepth) {
        return;
      }

      if (!existsSync(currentPath)) {
        return;
      }

      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) {
          return;
        }

        const fullPath = join(currentPath, entry);
        const stats = statSync(fullPath);
        const isDirectory = stats.isDirectory();

        // Check type filter
        if (args.type) {
          if (args.type === 'file' && isDirectory) continue;
          if (args.type === 'directory' && !isDirectory) continue;
        }

        // Check name filter
        if (!args.name || entry.includes(args.name)) {
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

    const truncated = results.length >= MAX_RESULTS;
    let output = results.join('\n');

    if (results.length === 0) {
      output = 'No matching files or directories found.';
    } else {
      output += `\n\nFound ${results.length} matches`;
      if (truncated) {
        output += ` (truncated at ${MAX_RESULTS} results)`;
      }
    }

    // TODO(Task 4): Apply truncateIfNeeded for large outputs
    // const truncatedResult = await truncateIfNeeded(output, {
    //   maxLines: 2000,
    //   maxBytes: 50000,
    //   prefix: `find_${ctx.callId}`,
    // })
    // return {
    //   title: `${results.length} matches`,
    //   output: truncatedResult.output,
    //   truncated: truncatedResult.truncated,
    //   outputPath: truncatedResult.outputPath,
    //   metadata: { ... }
    // }

    return {
      title: `${results.length} matches`,
      output,
      metadata: {
        path: startPath,
        matchCount: results.length,
        truncated,
      },
    };
  },
};