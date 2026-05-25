import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const grepTool: Tool<
  { pattern: string; path?: string; include?: string; maxResults?: number },
  { matches: { file: string; line: number; text: string }[]; count: number }
> = {
  name: 'grep',
  description:
    'Search file contents by regex pattern. Returns matching lines with file paths and line numbers.',
  inputSchema: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('Directory to search in'),
    include: z.string().optional().describe('File glob filter (e.g. "*.ts")'),
    maxResults: z.number().optional().default(100).describe('Max results'),
  }),
  requireApproval: false,
  async execute(input) {
    const { readFile, readdir } = await import('node:fs/promises');
    const { join, relative } = await import('node:path');
    const { pattern, path: cwd = '.', include, maxResults = 100 } = input;

    const regex = new RegExp(pattern, 'i');
    const matches: { file: string; line: number; text: string }[] = [];

    const includeRegex = include
      ? globToRegex(include)
      : null;

    async function walk(dir: string): Promise<void> {
      if (matches.length >= maxResults) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= maxResults) return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          if (includeRegex && !includeRegex.test(entry.name)) continue;
          try {
            const content = await readFile(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxResults) return;
              if (regex.test(lines[i])) {
                matches.push({ file: relative(cwd, full), line: i + 1, text: lines[i].trim() });
              }
            }
          } catch {
            // skip binary / unreadable files
          }
        }
      }
    }

    await walk(cwd);
    const result: { matches: { file: string; line: number; text: string }[]; count: number; suggestedActions?: string[] } = { matches, count: matches.length };
    if (matches.length > 0) {
      result.suggestedActions = [
        'Use file_read to view matched files',
        'Refine pattern to reduce results',
      ];
    }
    return result;
  },
  renderCall(input) {
    return `grep "${input.pattern}"`;
  },
  renderResult(output) {
    return `${output.count} matches`;
  },
};

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
