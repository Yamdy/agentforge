import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { tool, createToolRegistry } from '../src/tool.js';
import type { ToolDef } from '../src/types.js';

describe('tool()', () => {
  it('returns valid ToolDef with name, description, schema, execute', () => {
    const schema = z.object({ x: z.number() });
    const myTool = tool({
      name: 'test-tool',
      description: 'A test tool',
      schema,
      execute: async (params) => params.x,
    });

    expect(myTool.name).toBe('test-tool');
    expect(myTool.description).toBe('A test tool');
    expect(myTool.schema).toBe(schema);
    expect(typeof myTool.execute).toBe('function');
  });

  it('execute is callable with typed params', async () => {
    const schema = z.object({ x: z.number() });
    const myTool = tool({
      name: 'test-tool',
      description: 'A test tool',
      schema,
      execute: async (params) => params.x + 1,
    });

    const result = await myTool.execute({ x: 41 });
    expect(result).toBe(42);
  });

  it('throws when execute returns non-JSON value', async () => {
    const schema = z.object({});
    const myTool = tool({
      name: 'bad-tool',
      description: 'Returns undefined',
      schema,
      execute: async () => undefined as unknown as number,
    });

    await expect(myTool.execute({})).rejects.toThrow(
      'non-JSON-serializable'
    );
  });
});

describe('createToolRegistry()', () => {
  it('allows register/get/list/has', () => {
    const registry = createToolRegistry();
    const schema = z.object({ x: z.number() });
    const myTool = tool({
      name: 'test-tool',
      description: 'A test tool',
      schema,
      execute: async (params) => params.x,
    });

    registry.register(myTool);
    expect(registry.has('test-tool')).toBe(true);
    expect(registry.get('test-tool')).toBe(myTool);
    expect(registry.list()).toEqual([myTool]);
    expect(registry.has('nonexistent')).toBe(false);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('returns empty list when no tools registered', () => {
    const registry = createToolRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.has('anything')).toBe(false);
  });
});
