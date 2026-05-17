import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';
import { ToolRegistry } from '../src/tool-registry.js';

describe('ToolRegistry', () => {
  it('registers a tool and retrieves it by name', () => {
    const registry = new ToolRegistry();
    const echo: Tool = {
      name: 'echo',
      description: 'Returns its input',
      inputSchema: z.object({ message: z.string() }),
      execute: async ({ message }) => message,
    };

    registry.register(echo);
    const retrieved = registry.get('echo');

    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('echo');
    expect(retrieved!.description).toBe('Returns its input');
  });

  it('returns undefined for unregistered tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('lists all registered tools', () => {
    const registry = new ToolRegistry();
    const toolA: Tool = {
      name: 'a',
      description: 'Tool A',
      inputSchema: z.object({}),
      execute: async () => 'a',
    };
    const toolB: Tool = {
      name: 'b',
      description: 'Tool B',
      inputSchema: z.object({}),
      execute: async () => 'b',
    };

    registry.register(toolA);
    registry.register(toolB);

    expect(registry.getAll()).toHaveLength(2);
    expect(registry.getAll().map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('throws on duplicate registration', () => {
    const registry = new ToolRegistry();
    const tool: Tool = {
      name: 'dup',
      description: 'dup',
      inputSchema: z.object({}),
      execute: async () => '',
    };

    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/i);
  });

});
