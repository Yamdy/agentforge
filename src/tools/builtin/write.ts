import { Tool } from '../../types';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, isAbsolute, dirname } from 'path';

export const WriteTool: Tool = {
  name: 'write',
  description:
    'Writes a file to the local filesystem. If the directory does not exist, it will be created.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
      filePath: {
        type: 'string',
        description: 'The absolute path to the file to write',
      },
    },
    required: ['content', 'filePath'],
  },
  async execute(args: any) {
    let filepath = args.filePath;
    if (!isAbsolute(filepath)) {
      filepath = join(process.cwd(), filepath);
    }

    // 创建目录（如果不存在）
    const dir = dirname(filepath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filepath, args.content);
    return `File written successfully: ${filepath}`;
  },
};
