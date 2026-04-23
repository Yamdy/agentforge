import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/registry';
import { createMockToolContext } from '../../src/tool/context';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  const mockCtx = createMockToolContext();

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register a tool', () => {
    const tool = {
      name: 'test-tool',
      description: 'A test tool',
      execute: async (args: Record<string, unknown>) => 'result',
    };
    registry.register(tool);
    expect(registry.get('test-tool')).toBeDefined();
  });

  it('should list all tools', () => {
    registry.register({
      name: 'tool1',
      description: 'Tool 1',
      execute: async () => '1',
    });
    registry.register({
      name: 'tool2',
      description: 'Tool 2',
      execute: async () => '2',
    });
    expect(registry.list()).toHaveLength(2);
  });

  it('should throw error for missing tool', async () => {
    await expect(() => registry.execute('missing', {}, mockCtx)).rejects.toThrow('Tool not found');
  });

  it('should execute a legacy tool', async () => {
    registry.register({
      name: 'echo',
      description: 'Echoes input',
      execute: async (args: Record<string, unknown>) => JSON.stringify(args),
    });
    const result = await registry.execute('echo', { foo: 'bar' }, mockCtx);
    expect(result.output).toBe('{"foo":"bar"}');
  });
});
