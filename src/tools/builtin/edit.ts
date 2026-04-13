import { Tool } from '../../types';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, isAbsolute, dirname } from 'path';
import { mkdirSync } from 'fs';

interface EditToolArgs {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export const EditTool: Tool = {
  name: 'edit',
  description:
    'Edit a file by replacing an exact string. Can perform single or multiple replacements.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'The path to the file to edit',
      },
      oldString: {
        type: 'string',
        description: 'The exact string to replace (must match completely including whitespace)',
      },
      newString: {
        type: 'string',
        description: 'The new string to replace it with',
      },
      replaceAll: {
        type: 'boolean',
        description: 'Replace all occurrences instead of just the first (default: false)',
        optional: true,
      },
    },
    required: ['filePath', 'oldString', 'newString'],
  },
  async execute(args: Record<string, unknown>) {
    const parsed = args as unknown as EditToolArgs;
    let filePath = parsed.filePath;
    if (!isAbsolute(filePath)) {
      filePath = join(process.cwd(), filePath);
    }

    // Create directory if it doesn't exist when creating a new file
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // For new files, oldString should be empty
    if (!existsSync(filePath)) {
      if (parsed.oldString === '') {
        writeFileSync(filePath, parsed.newString, 'utf8');
        return `Created new file: ${filePath}\nWrote ${Buffer.byteLength(parsed.newString, 'utf8')} bytes`;
      } else {
        return `File not found: ${filePath}. To create a new file, oldString must be empty.`;
      }
    }

    // Read existing file
    const content = readFileSync(filePath, 'utf8');
    const oldContent = content;

    let newContent: string;
    let replacements: number;

    if (parsed.replaceAll) {
      const regex = new RegExp(parsed.oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      newContent = content.replace(regex, parsed.newString);
      replacements = (content.match(regex) || []).length;
    } else {
      const index = content.indexOf(parsed.oldString);
      if (index === -1) {
        return `Error: String not found in ${filePath}. Please check the exact string and try again.`;
      }
      newContent =
        content.substring(0, index) +
        parsed.newString +
        content.substring(index + parsed.oldString.length);
      replacements = 1;
    }

    // Check if any replacements were made
    if (newContent === oldContent) {
      return `No changes made. The string was found but resulted in the same content.`;
    }

    // Write back
    writeFileSync(filePath, newContent, 'utf8');
    const oldLines = oldContent.split('\n').length;
    const newLines = newContent.split('\n').length;

    return `Successfully edited ${filePath}\nReplaced ${replacements} occurrence(s)\nLines: ${oldLines} → ${newLines}`;
  },
};
