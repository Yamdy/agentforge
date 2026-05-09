import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { echoTool } from '../src/echo.js';

describe('echoTool', () => {
  it('returns the input message', async () => {
    const result = await echoTool.execute({ message: 'hello world' }, {});
    expect(result).toBe('hello world');
  });

  it('has correct metadata', () => {
    expect(echoTool.name).toBe('echo');
    expect(echoTool.description).toBeDefined();
    expect(echoTool.inputSchema).toBeDefined();
  });

  it('inputSchema accepts a string message', () => {
    const schema = echoTool.inputSchema as z.ZodTypeAny;
    expect(schema.safeParse({ message: 'test' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });
});
