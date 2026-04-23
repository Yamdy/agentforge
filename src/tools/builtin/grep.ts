import { LegacyTool as Tool } from '../../types';
import { existsSync, statSync, readFileSync } from 'fs';
import { join, isAbsolute } from 'path';
import { glob } from 'glob';

interface GrepToolArgs {
  pattern: string;
  path: string;
  include?: string;
  caseInsensitive?: boolean;
  maxResults?: number;
}

export const GrepTool: Tool = {
  name: 'grep',
  description:
    'Search for a regex pattern in files within a directory. Returns matching lines with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'The directory or file to search in',
      },
      include: {
        type: 'string',
        description: 'Glob pattern for files to include (e.g., "*.js", "*.{ts,tsx}")',
        optional: true,
      },
      caseInsensitive: {
        type: 'boolean',
        description: 'Whether to use case-insensitive search (default: false)',
        optional: true,
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return (default: 200)',
        optional: true,
      },
    },
    required: ['pattern', 'path'],
  },
  async execute(args: Record<string, unknown>) {
    const parsed = args as unknown as GrepToolArgs;
    let searchPath = parsed.path;
    if (!isAbsolute(searchPath)) {
      searchPath = join(process.cwd(), searchPath);
    }

    if (!existsSync(searchPath)) {
      return `Path not found: ${searchPath}`;
    }

    const stats = statSync(searchPath);
    const files: string[] = [];

    if (stats.isFile()) {
      files.push(searchPath);
    } else {
      const includePattern = parsed.include || '**/*';
      const globPattern = join(searchPath, includePattern);
      files.push(...glob.sync(globPattern, { absolute: true, nodir: true }));
    }

    if (files.length === 0) {
      return 'No files matched the search criteria.';
    }

    const flags = parsed.caseInsensitive ? 'i' : '';
    const regex = new RegExp(parsed.pattern, flags);
    const maxResults = parsed.maxResults || 200;
    const matches: string[] = [];
    let matchCount = 0;
    let fileCount = 0;

    for (const file of files) {
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
      return `No matches found for pattern "${parsed.pattern}" in ${files.length} files.`;
    }

    return `${matches.join('\n')}\n\nFound ${matchCount} matches in ${fileCount} files`;
  },
};
