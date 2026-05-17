import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';

export const calculatorTool: Tool<
  { expression: string },
  { result: number; expression: string }
> = {
  name: 'calculator',
  description:
    'Evaluate a mathematical expression. Supports +, -, *, /, **, %, parentheses, and Math functions.',
  inputSchema: z.object({
    expression: z
      .string()
      .describe('Math expression (e.g. "2 + 3 * 4", "Math.sqrt(144)", "3.14 * 10 ** 2")'),
  }),
  requireApproval: false,
  async execute(input) {
    const { expression } = input;

    const sanitized = expression.replace(/\s+/g, ' ').trim();

    if (/[^0-9+\-*/().%\s^,a-zA-Z.]/.test(sanitized.replace(/Math\.\w+/g, ''))) {
      throw new Error(`Disallowed characters in expression: "${expression}"`);
    }

    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();

    if (typeof result !== 'number' || !Number.isFinite(result)) {
      throw new Error(`Expression did not evaluate to a finite number: ${result}`);
    }

    return { result, expression };
  },
  renderCall(input) {
    return `calc: ${input.expression}`;
  },
  renderResult(output) {
    return `${output.expression} = ${output.result}`;
  },
};
