import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { existsSync, statSync, readFileSync } from 'fs';
import { join, isAbsolute } from 'path';
import { glob } from 'glob';
import { truncateIfNeededAsync } from '../../truncate/index.js';

// ========== Zod Parameter Schema ==========

const GrepParams = z.object({
  pattern: z.string().describe('The regex pattern to search for'),
  path: z.string().describe('The directory or file to search in'),
  include: z
    .string()
    .optional()
    .describe('Glob pattern for files to include (e.g., "*.js", "*.{ts,tsx}")'),
  caseInsensitive: z
    .boolean()
    .optional()
    .describe('Whether to use case-insensitive search (default: false)'),
  maxResults: z
    .number()
    .optional()
    .describe('Maximum number of results to return (default: 200)'),
});

type GrepParamsType = z.infer<typeof GrepParams>;

// ========== Metadata Interface ==========

interface GrepMetadata {
  pattern: string;
  path: string;
  matchCount: number;
  fileCount: number;
  truncated: boolean;
}

// ========== Tool Implementation ==========

export const GrepTool: Tool<GrepParamsType, GrepMetadata> = {
  name: 'grep',
  description:
    'Search for a regex pattern in files within a directory. Returns matching lines with line numbers.',
  parameters: GrepParams,
  permission: {
    category: 'grep',
    extractInput: (args) => (args as GrepParamsType).pattern,
  },

  async execute(
    args: GrepParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<GrepMetadata>> {
    let searchPath = args.path;
    if (!isAbsolute(searchPath)) {
      searchPath = join(process.cwd(), searchPath);
    }

    if (!existsSync(searchPath)) {
      return {
        title: 'Error',
        output: `Path not found: ${searchPath}`,
        metadata: {
          pattern: args.pattern,
          path: searchPath,
          matchCount: 0,
          fileCount: 0,
          truncated: false,
        },
      };
    }

    ctx.metadata({ title: `Grepping: ${args.pattern}...` });

    const stats = statSync(searchPath);
    const files: string[] = [];

    if (stats.isFile()) {
      files.push(searchPath);
    } else {
      const includePattern = args.include || '**/*';
      const globPattern = join(searchPath, includePattern);
      files.push(...glob.sync(globPattern, { absolute: true, nodir: true }));
    }

    if (files.length === 0) {
      return {
        title: 'No files matched',
        output: 'No files matched the search criteria.',
        metadata: {
          pattern: args.pattern,
          path: searchPath,
          matchCount: 0,
          fileCount: 0,
          truncated: false,
        },
      };
    }

    const flags = args.caseInsensitive ? 'i' : '';
    const regex = new RegExp(args.pattern, flags);
    const maxResults = args.maxResults || 200;
    const matches: string[] = [];
    let matchCount = 0;
    let fileCount = 0;

    for (const file of files) {
      // Check abort signal
      if (ctx.abort.aborted) {
        return {
          title: 'Cancelled',
          output: 'Search was cancelled.',
          metadata: {
            pattern: args.pattern,
            path: searchPath,
            matchCount,
            fileCount,
            truncated: false,
          },
        };
      }

      try {
        const content = readFileSync(file, 'utf8');
        const lines = content.split('\n');
        let foundInFile = false;

        for (let i = 0; i < lines.length; i++) {
          const lineNum = i + 1;
          const line = lines[i];

          if (regex.test(line)) {
            const relativePath = file.replace(process.cwd() + '/', '');
            matches.push(`${relativePath}:${lineNum}: ${line.trimEnd()}`);
            matchCount++;
            foundInFile = true;

            if (matchCount >= maxResults) {
              break;
            }
          }
        }

        if (foundInFile) {
          fileCount++;
        }

        if (matchCount >= maxResults) {
          matches.push(`\n... (truncated at ${maxResults} matches, use more specific pattern)`);
          break;
        }
      } catch {
        // Skip unreadable files
        continue;
      }
    }

    if (matches.length === 0) {
      return {
        title: `No matches: ${args.pattern}`,
        output: `No matches found for pattern "${args.pattern}" in ${files.length} files.`,
        metadata: {
          pattern: args.pattern,
          path: searchPath,
          matchCount: 0,
          fileCount: 0,
          truncated: false,
        },
      };
    }

    const output = `${matches.join('\n')}\n\nFound ${matchCount} matches in ${fileCount} files`;
    const resultTruncated = matchCount >= maxResults;

    // Apply truncate system for large outputs
    const truncatedResult = await truncateIfNeededAsync(output, {
      maxLines: 2000,
      maxBytes: 50000,
      prefix: `grep_${ctx.callId}`,
    });

    return {
      title: `${matchCount} matches for ${args.pattern}`,
      output: truncatedResult.output,
      truncated: truncatedResult.truncated || resultTruncated,
      outputPath: truncatedResult.outputPath,
      metadata: {
        pattern: args.pattern,
        path: searchPath,
        matchCount,
        fileCount,
        truncated: truncatedResult.truncated || resultTruncated,
      },
    };
  },
};