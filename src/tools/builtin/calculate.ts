import type { Tool } from '../../types.js';

export interface CalculatorToolArgs {
  expression: string;
}

export const CalculatorTool: Tool = {
  name: 'calculate',
  description: 'Calculate a mathematical expression',
  parameters: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Mathematical expression to calculate (e.g. "2 + 2 * 3")',
      },
    },
    required: ['expression'],
  },
  execute: async (args: Record<string, unknown>) => {
    const expression = args.expression as string;

    // Basic safe calculation - only allow numbers and operators
    const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');

    try {
      // eslint-disable-next-line no-eval
      const result = eval(sanitized);
      return `${result}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Calculation failed: ${errorMsg}`);
    }
  },
};
