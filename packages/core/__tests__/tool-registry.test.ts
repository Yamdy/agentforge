import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool } from '@agentforge/sdk';
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

  describe('toAiSdkTools', () => {
    it('generates AI SDK-compatible tool definitions', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'get_weather',
        description: 'Get weather for a city',
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => `${city}: sunny`,
      });

      const sdkTools = registry.toAiSdkTools();

      expect(sdkTools.get_weather).toBeDefined();
      expect(sdkTools.get_weather.description).toBe('Get weather for a city');
      expect(sdkTools.get_weather.inputSchema).toBeDefined();

      const result = await sdkTools.get_weather.execute({ city: 'Tokyo' });
      expect(result).toBe('Tokyo: sunny');
    });

    it('returns empty object when no tools registered', () => {
      const registry = new ToolRegistry();
      expect(Object.keys(registry.toAiSdkTools())).toHaveLength(0);
    });

    it('truncates large string outputs at configured maxOutputLength', async () => {
      const registry = new ToolRegistry({ maxOutputLength: 10 });
      registry.register({
        name: 'verbose',
        description: 'Returns a lot of text',
        inputSchema: z.object({}),
        execute: async () => 'A'.repeat(100),
      });

      const result = await registry.toAiSdkTools().verbose.execute({});
      expect(result).toBe('AAAAAAAAAA... [truncated]');
    });

    it('does not truncate outputs within limit', async () => {
      const registry = new ToolRegistry({ maxOutputLength: 100 });
      registry.register({
        name: 'short',
        description: 'Short output',
        inputSchema: z.object({}),
        execute: async () => 'hello',
      });

      const result = await registry.toAiSdkTools().short.execute({});
      expect(result).toBe('hello');
    });
  });
});
