import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool, ToolExecutionContext, ToolHookContext } from '@agentforge/sdk';
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

    it('calls beforeHook before tool execution', async () => {
      const calls: string[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'test_tool',
        description: 'Test',
        inputSchema: z.object({ x: z.string() }),
        execute: async ({ x }) => `result:${x}`,
      });

      registry.addBeforeHook(async (ctx: ToolHookContext) => {
        calls.push(`before:${ctx.toolName}`);
      });

      const sdkTools = registry.toAiSdkTools();
      await sdkTools.test_tool.execute({ x: 'hello' });
      expect(calls).toEqual(['before:test_tool']);
    });

    it('calls afterHook after tool execution with result', async () => {
      const calls: string[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'test_tool',
        description: 'Test',
        inputSchema: z.object({ x: z.string() }),
        execute: async ({ x }) => `result:${x}`,
      });

      registry.addAfterHook(async (ctx: ToolHookContext) => {
        calls.push(`after:${ctx.toolName}:${ctx.result}`);
      });

      const sdkTools = registry.toAiSdkTools();
      await sdkTools.test_tool.execute({ x: 'hello' });
      expect(calls).toEqual(['after:test_tool:result:hello']);
    });

    it('validates input against Zod schema and throws clear error on invalid input', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'strict',
        description: 'Needs a number',
        inputSchema: z.object({ count: z.number() }),
        execute: async ({ count }) => `count:${count}`,
      });

      const sdkTools = registry.toAiSdkTools();
      await expect(sdkTools.strict.execute({ count: 'not-a-number' })).rejects.toThrow(
        /Tool "strict" input validation failed/,
      );
    });

    it('truncates large JSON-serializable outputs to structured marker', async () => {
      const registry = new ToolRegistry({ maxOutputLength: 20 });
      registry.register({
        name: 'big_obj',
        description: 'Returns big object',
        inputSchema: z.object({}),
        execute: async () => ({ items: Array.from({ length: 100 }, (_, i) => i) }),
      });

      const result = await registry.toAiSdkTools().big_obj.execute({}) as { truncated: boolean; preview: string };
      expect(result.truncated).toBe(true);
      expect(result.preview.length).toBeLessThanOrEqual(20);
    });

    it('passes ToolExecutionContext to tool execute with span info', async () => {
      let receivedContext: ToolExecutionContext | undefined;
      const registry = new ToolRegistry();
      registry.register({
        name: 'ctx_tool',
        description: 'Captures context',
        inputSchema: z.object({}),
        execute: async (_input, ctx) => {
          receivedContext = ctx;
          return 'ok';
        },
      });

      const mockSpan = { spanId: 'span-123', traceId: 'trace-456' };
      registry.setToolExecutionContext({ span: mockSpan });

      await registry.toAiSdkTools().ctx_tool.execute({});
      expect(receivedContext?.span).toEqual(mockSpan);
    });

    it('calls afterHook even when tool execution throws', async () => {
      const hookCalls: string[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'failing_tool',
        description: 'Always fails',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('Tool crashed!'); },
      });

      registry.addAfterHook(async (ctx) => {
        hookCalls.push(`after:${ctx.toolName}:error=${ctx.error?.message}`);
      });

      const sdkTools = registry.toAiSdkTools();
      await expect(sdkTools.failing_tool.execute({})).rejects.toThrow('Tool crashed!');
      expect(hookCalls).toEqual(['after:failing_tool:error=Tool crashed!']);
    });
  });
});
