import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../../types';
import { evaluate } from 'mathjs';

// ========== Zod Parameter Schema ==========

const CalculatorParams = z.object({
  expression: z.string().describe('Mathematical expression to calculate (e.g. "2 + 2 * 3")'),
});

type CalculatorParamsType = z.infer<typeof CalculatorParams>;

// ========== Metadata Interface ==========

interface CalculatorMetadata {
  expression: string;
  result: string;
}

// ========== Tool Implementation ==========

export const CalculatorTool: Tool<CalculatorParamsType, CalculatorMetadata> = {
  name: 'calculate',
  description: 'Calculate a mathematical expression',
  parameters: CalculatorParams,

  async execute(
    args: CalculatorParamsType,
    ctx: ToolContext
  ): Promise<ToolResult<CalculatorMetadata>> {
    const { expression } = args;

    ctx.metadata({ title: `Calculating: ${expression}` });

    try {
      const result = evaluate(expression);
      if (typeof result === 'function') {
        throw new Error('Function evaluation is not allowed');
      }

      const resultStr = `${result}`;

      return {
        title: `Result: ${resultStr}`,
        output: resultStr,
        metadata: {
          expression,
          result: resultStr,
        },
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Calculation failed: ${errorMsg}`, { cause: error });
    }
  },
};

// ========== Legacy Export (for backward compatibility) ==========

export type CalculatorToolArgs = CalculatorParamsType;