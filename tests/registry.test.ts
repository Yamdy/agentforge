import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../src/registry';
import { Tool } from '../src/types';

const mockTool: Tool = {
  name: 'calculator',
  description: 'Calculate math expression',
  execute: async (args) => String(eval(args.expr as string)),
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register and retrieve tools', () => {
    registry.register(mockTool);

    const tool = registry.get('calculator');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('calculator');
  });

  it('should return undefined for non-existent tool', () => {
    const tool = registry.get('unknown');
    expect(tool).toBeUndefined();
  });

  it('should list all tools', () => {
    registry.register(mockTool);

    const tools = registry.list();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('calculator');
  });

  it('should execute tool', async () => {
    registry.register(mockTool);

    const result = await registry.execute('calculator', { expr: '2+2' });
    expect(result).toBe('4');
  });
});
