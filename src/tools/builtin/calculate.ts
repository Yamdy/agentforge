import type { LegacyTool as Tool } from '../../types.js';
import { evaluate } from 'mathjs';

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

    try {
      const result = evaluate(expression);
      if (typeof result === 'function') {
        throw new Error('Function evaluation is not allowed');
      }
      return `${result}`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Calculation failed: ${errorMsg}`, { cause: error });
    }
  },
};
