import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { join, isAbsolute } from 'path';
import { glob } from 'glob';

// ========== Zod Parameter Schema ==========

const GlobParams = z.object({
  pattern: z
    .string()
    .describe('The glob pattern to match (e.g., "**/*.ts", "src/**/*.{js,ts}")'),
  cwd: z
    .string()
    .optional()
    .describe('Current working directory for the search (default: process cwd)'),
  includeDirectories: z
    .boolean()
    .optional()
    .describe('Whether to include directories in results (default: false)'),
});

type GlobParamsType = z.infer<typeof GlobParams>;

// ========== Metadata Interface ==========

interface GlobMetadata {
  pattern: string;
  cwd: string;
  matchCount: number;
}

// ========== Tool Implementation ==========

export const GlobTool: Tool<GlobParamsType, GlobMetadata> = {
  name: 'glob',
  description:
    'Find files using glob pattern matching. Supports wildcards and pattern matching.',
  parameters: GlobParams,

  async execute(
    args: GlobParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<GlobMetadata>> {
    const { pattern, includeDirectories } = args;
    let cwd = args.cwd || process.cwd();
    if (!isAbsolute(cwd)) {
      cwd = join(process.cwd(), cwd);
    }

    ctx.metadata({ title: `Glob: ${pattern}` });

    const absolutePattern = isAbsolute(pattern) ? pattern : join(cwd, pattern);
    const files = glob.sync(absolutePattern, {
      nodir: !includeDirectories,
      absolute: true,
    });

    if (files.length === 0) {
      return {
        title: `No matches: ${pattern}`,
        output: `No files matched pattern "${pattern}"`,
        metadata: { pattern, cwd, matchCount: 0 },
      };
    }

    const relativeFiles = files.map((file) => file.replace(process.cwd() + '/', ''));
    relativeFiles.sort();

    const output = `${relativeFiles.join('\n')}\n\nFound ${files.length} matches`;

    return {
      title: `${files.length} matches for ${pattern}`,
      output,
      metadata: { pattern, cwd, matchCount: files.length },
    };
  },
};