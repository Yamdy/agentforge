import { Tool } from '../../types';
import { join, isAbsolute } from 'path';
import { glob } from 'glob';

interface GlobToolArgs {
  pattern: string;
  cwd?: string;
  includeDirectories?: boolean;
}

export const GlobTool: Tool = {
  name: 'glob',
  description: 'Find files using glob pattern matching. Supports wildcards and pattern matching.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match (e.g., "**/*.ts", "src/**/*.{js,ts}")',
      },
      cwd: {
        type: 'string',
        description: 'Current working directory for the search (default: process cwd)',
        optional: true,
      },
      includeDirectories: {
        type: 'boolean',
        description: 'Whether to include directories in results (default: false)',
        optional: true,
      },
    },
    required: ['pattern'],
  },
  async execute(args: Record<string, unknown>) {
    const parsed = args as unknown as GlobToolArgs;
    let cwd = parsed.cwd || process.cwd();
    if (!isAbsolute(cwd)) {
      cwd = join(process.cwd(), cwd);
    }

    const absolutePattern = isAbsolute(parsed.pattern) ? parsed.pattern : join(cwd, parsed.pattern);
    const files = glob.sync(absolutePattern, {
      nodir: !parsed.includeDirectories,
      absolute: true,
    });

    if (files.length === 0) {
      return `No files matched pattern "${parsed.pattern}"`;
    }

    const relativeFiles = files.map((file) => file.replace(process.cwd() + '/', ''));
    relativeFiles.sort();

    return `${relativeFiles.join('\n')}\n\nFound ${files.length} matches`;
  },
};
