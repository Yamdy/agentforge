import fs from 'fs';
import path from 'path';
import type { Tool } from '../../types.js';
import { createLogger } from '../../logger/index.js';

const log = createLogger('tools:diffpatch');

export interface DiffPatchEdit {
  filePath: string;
  startLine?: number;
  endLine?: number;
  replacement: string;
}

/**
 * Find the target section in the file content and replace it with the replacement.
 * Uses line numbers for precise targeting.
 */
function applyDiffPatch(content: string, edit: DiffPatchEdit): string {
  const lines = content.split('\n');

  // If no line range given, treat as full file replacement
  if (edit.startLine === undefined && edit.endLine === undefined) {
    return edit.replacement;
  }

  const start = edit.startLine ?? 1;
  const end = edit.endLine ?? lines.length;

  // Lines are 1-indexed in the UI/API
  const before = lines.slice(0, start - 1);
  const after = lines.slice(end);

  // Insert the replacement lines
  return [...before, ...edit.replacement.split('\n'), ...after].join('\n');
}

/**
 * Diff/Patch tool - allows targeted editing of files instead of full rewrites
 *
 * This is useful for:
 * - Incremental code changes (modify a function instead of rewriting the whole file)
 * - Small bug fixes that don't need changing everything
 * - Reduces token usage compared to reading/writing the entire file
 */
export const diffpatchTool: Tool = {
  name: 'diff_edit',
  description: `Make a targeted edit to a file by replacing a specific range of lines.
Use this for incremental changes instead of rewriting the entire file.
You specify:
- file path: the file to edit
- startLine: starting line number (1-indexed) of the section to replace
- endLine: ending line number (1-indexed) of the section to replace
- replacement: the new content for this section

This reduces token consumption and is more accurate than full file rewrites for small changes.`,
  parameters: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute or relative path to the file to edit' },
      startLine: {
        type: 'number',
        description:
          'Starting line number (1-indexed) of the section to replace. If not provided with endLine, replaces entire file.',
      },
      endLine: {
        type: 'number',
        description: 'Ending line number (1-indexed) of the section to replace',
      },
      replacement: {
        type: 'string',
        description: 'The new content to replace the specified range with',
      },
    },
    required: ['filePath', 'replacement'],
  },
  execute: async (args: Record<string, unknown>) => {
    if (typeof args.filePath !== 'string') {
      throw new Error('filePath must be a string');
    }
    const filePath = args.filePath;
    const startLine = typeof args.startLine === 'number' ? args.startLine : undefined;
    const endLine = typeof args.endLine === 'number' ? args.endLine : undefined;
    const replacement = typeof args.replacement === 'string' ? args.replacement : '';

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}. Cannot edit non-existent file.`);
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const newContent = applyDiffPatch(content, {
      filePath,
      startLine,
      endLine,
      replacement,
    });

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await fs.promises.writeFile(filePath, newContent, 'utf-8');
    log.debug(`[diff_edit] Edited file ${filePath} (lines ${startLine}-${endLine})`);

    const lineCount = newContent.split('\n').length;
    const originalLineCount = content.split('\n').length;

    return `Successfully edited file: ${filePath}
- Original: ${originalLineCount} lines
- New: ${lineCount} lines
- Changed lines: ${(endLine ?? lineCount) - (startLine ?? 1) + 1} lines changed
`;
  },
};
