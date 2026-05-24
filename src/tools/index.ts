import { LegacyTool as Tool } from '../types';

export const calculatorTool: Tool = {
  name: 'calculator',
  description:
    'Calculate a math expression and return the result. Input should be a math expression like "2+2" or "123*456".',
  parameters: {
    type: 'object',
    properties: {
      expr: {
        type: 'string',
        description: 'The math expression to calculate',
      },
    },
    required: ['expr'],
  },
  execute: async (args) => {
    const expr = (args.expr as string) || '';
    if (!expr) {
      return 'Error: No expression provided';
    }
    try {
      const result = calculate(expr);
      return String(result);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : 'Invalid expression'}`;
    }
  },
};

function calculate(expr: string): number {
  const tokens = tokenize(expr);
  if (tokens.length === 0) throw new Error('Empty expression');
  return parseExpression(tokens);
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const char of expr) {
    if (char.match(/[0-9.]/)) {
      current += char;
    } else if (char.match(/[+\-*/()]/)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
    } else if (char.match(/\s/)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      throw new Error(`Invalid character: ${char}`);
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseExpression(tokens: string[]): number {
  let index = 0;

  function parseTerm(): number {
    let result = parseFactor();
    while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
      const op = tokens[index++];
      const right = parseFactor();
      if (op === '*') result *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        result /= right;
      }
    }
    return result;
  }

  function parseFactor(): number {
    if (index >= tokens.length) throw new Error('Unexpected end of expression');
    const token = tokens[index++];
    if (token === '(') {
      const result = parseAddSub();
      if (index >= tokens.length || tokens[index++] !== ')') {
        throw new Error('Mismatched parentheses');
      }
      return result;
    }
    if (token === '-') {
      return -parseFactor();
    }
    const num = parseFloat(token);
    if (isNaN(num)) throw new Error(`Invalid number: ${token}`);
    return num;
  }

  function parseAddSub(): number {
    let result = parseTerm();
    while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
      const op = tokens[index++];
      const right = parseTerm();
      if (op === '+') result += right;
      else if (op === '-') result -= right;
    }
    return result;
  }

  return parseAddSub();
}

export const searchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for information. Takes a query string.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
    },
    required: ['query'],
  },
  execute: async (args) => {
    const query = args.query as string;
    if (!query) {
      return 'Error: No query provided';
    }
    return `Search results for: ${query}\n(This is a placeholder - integrate with a real search API)`;
  },
};

export const allTools: Tool[] = [calculatorTool, searchTool];
