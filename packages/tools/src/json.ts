import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const jsonTool: Tool<
  { operation: 'parse' | 'stringify' | 'query'; data: string; path?: string; indent?: number },
  { result: string }
> = {
  name: 'json',
  description:
    'Parse, stringify, or query JSON data. Query uses dot-notation paths (e.g. "users.0.name").',
  inputSchema: z.object({
    operation: z
      .enum(['parse', 'stringify', 'query'])
      .describe('Operation to perform'),
    data: z.string().describe('JSON string or value to process'),
    path: z
      .string()
      .optional()
      .describe('Dot-notation path for query (e.g. "users.0.name")'),
    indent: z.number().optional().default(2).describe('Indentation for stringify'),
  }),
  requireApproval: false,
  async execute(input) {
    const { operation, data, path, indent = 2 } = input;

    switch (operation) {
      case 'parse': {
        const parsed = JSON.parse(data);
        return { result: JSON.stringify(parsed, null, indent) };
      }
      case 'stringify': {
        const parsed = JSON.parse(data);
        return { result: JSON.stringify(parsed, null, indent) };
      }
      case 'query': {
        if (!path) throw new Error('path is required for query operation');
        const parsed = JSON.parse(data);
        const result = path.split('.').reduce((obj: unknown, key: string) => {
          if (obj == null) return undefined;
          return (obj as Record<string, unknown>)[key];
        }, parsed);
        return { result: JSON.stringify(result, null, indent) };
      }
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
  renderCall(input) {
    return `json ${input.operation}${input.path ? ` .${input.path}` : ''}`;
  },
  renderResult(output) {
    return output.result.slice(0, 200);
  },
};
