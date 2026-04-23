import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, isAbsolute, dirname } from 'path';
import { mkdirSync } from 'fs';

// ========== Zod Parameter Schema ==========

const EditParams = z.object({
  filePath: z.string().describe('The path to the file to edit'),
  oldString: z
    .string()
    .describe('The exact string to replace (must match completely including whitespace)'),
  newString: z.string().describe('The new string to replace it with'),
  replaceAll: z
    .boolean()
    .optional()
    .describe('Replace all occurrences instead of just the first (default: false)'),
});

type EditParamsType = z.infer<typeof EditParams>;

// ========== Metadata Interface ==========

interface EditMetadata {
  path: string;
  replacements: number;
  oldLines: number;
  newLines: number;
  created: boolean;
}

// ========== Tool Implementation ==========

export const EditTool: Tool<EditParamsType, EditMetadata> = {
  name: 'edit',
  description:
    'Edit a file by replacing an exact string. Can perform single or multiple replacements.',
  parameters: EditParams,

  async execute(
    args: EditParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<EditMetadata>> {
    let filePath = args.filePath;
    if (!isAbsolute(filePath)) {
      filePath = join(process.cwd(), filePath);
    }

    // Create directory if it doesn't exist when creating a new file
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    ctx.metadata({ title: `Editing ${filePath}...` });

    // For new files, oldString should be empty
    if (!existsSync(filePath)) {
      if (args.oldString === '') {
        writeFileSync(filePath, args.newString, 'utf8');
        const newLines = args.newString.split('\n').length;
        return {
          title: `Created: ${filePath}`,
          output: `Created new file: ${filePath}\nWrote ${Buffer.byteLength(args.newString, 'utf8')} bytes`,
          metadata: {
            path: filePath,
            replacements: 1,
            oldLines: 0,
            newLines,
            created: true,
          },
        };
      } else {
        return {
          title: 'Error',
          output: `File not found: ${filePath}. To create a new file, oldString must be empty.`,
          metadata: {
            path: filePath,
            replacements: 0,
            oldLines: 0,
            newLines: 0,
            created: false,
          },
        };
      }
    }

    // Read existing file
    const content = readFileSync(filePath, 'utf8');
    const oldContent = content;

    let newContent: string;
    let replacements: number;

    if (args.replaceAll) {
      const regex = new RegExp(args.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      newContent = content.replace(regex, args.newString);
      replacements = (content.match(regex) || []).length;
    } else {
      const index = content.indexOf(args.oldString);
      if (index === -1) {
        return {
          title: 'Error',
          output: `Error: String not found in ${filePath}. Please check the exact string and try again.`,
          metadata: {
            path: filePath,
            replacements: 0,
            oldLines: content.split('\n').length,
            newLines: content.split('\n').length,
            created: false,
          },
        };
      }
      newContent =
        content.substring(0, index) +
        args.newString +
        content.substring(index + args.oldString.length);
      replacements = 1;
    }

    // Check if any replacements were made
    if (newContent === oldContent) {
      return {
        title: 'No changes',
        output: 'No changes made. The string was found but resulted in the same content.',
        metadata: {
          path: filePath,
          replacements: 0,
          oldLines: oldContent.split('\n').length,
          newLines: newContent.split('\n').length,
          created: false,
        },
      };
    }

    // Write back
    writeFileSync(filePath, newContent, 'utf8');
    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;

    return {
      title: `Edited ${filePath}`,
      output: `Successfully edited ${filePath}\nReplaced ${replacements} occurrence(s)\nLines: ${oldLines} → ${newLines}`,
      metadata: {
        path: filePath,
        replacements,
        oldLines,
        newLines,
        created: false,
      },
    };
  },
};