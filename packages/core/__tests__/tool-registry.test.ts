import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@agentforge/sdk';
import { ToolRegistry } from '../src/tool-registry.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';

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

      const result = await sdkTools.get_weather.execute!({ city: 'Tokyo' });
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

      const result = await registry.toAiSdkTools().verbose.execute!({});
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

      const result = await registry.toAiSdkTools().short.execute!({});
      expect(result).toBe('hello');
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
      await expect(sdkTools.strict.execute!({ count: 'not-a-number' })).rejects.toThrow(
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

      const result = await registry.toAiSdkTools().big_obj.execute!({}) as { truncated: boolean; preview: string };
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

      await registry.toAiSdkTools().ctx_tool.execute!({});
      expect(receivedContext?.span).toEqual(mockSpan);
    });

    it('invokes tool.before and tool.after hooks via HookManager', async () => {
      const hookCalls: string[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);

      hookManager.register({ point: 'tool.before', handler: (input) => { hookCalls.push(`before:${(input as Record<string, unknown>).toolName}`); } });
      hookManager.register({ point: 'tool.after', handler: (input, output) => { hookCalls.push(`after:${(input as Record<string, unknown>).toolName}:${(output as Record<string, unknown>).result}`); } });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'double',
        description: 'Double a number',
        inputSchema: z.object({ x: z.number() }),
        execute: async ({ x }) => x * 2,
      });

      registry.setToolExecutionContext({ sessionId: 'test-session' });

      const result = await registry.toAiSdkTools().double.execute!({ x: 5 });
      expect(result).toBe(10);
      expect(hookCalls).toEqual(['before:double', 'after:double:10']);
    });

    it('tool.after hook can modify result', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);

      hookManager.register({
        point: 'tool.after',
        handler: (_input, output) => { (output as Record<string, unknown>).result = 'evicted'; },
      });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'test',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'original',
      });

      registry.setToolExecutionContext({ sessionId: 's1' });

      const result = await registry.toAiSdkTools().test.execute!({});
      expect(result).toBe('evicted');
    });

    it('tool.after hook fires on error with error info', async () => {
      const hookCalls: string[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);

      hookManager.register({
        point: 'tool.after',
        handler: (_input, output) => { hookCalls.push(`error:${(output as Record<string, unknown>).error}`); },
      });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'failing_tool',
        description: 'Always fails',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('Tool crashed!'); },
      });

      registry.setToolExecutionContext({ sessionId: 's1' });

      const sdkTools = registry.toAiSdkTools();
      await expect(sdkTools.failing_tool.execute!({})).rejects.toThrow('Tool crashed!');
      expect(hookCalls).toEqual(['error:Tool crashed!']);
    });
  });
});
