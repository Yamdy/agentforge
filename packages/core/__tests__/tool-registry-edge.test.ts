import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool } from '@agentforge/sdk';
import { ToolRegistry } from '../src/tool-registry.js';

describe('ToolRegistry edge cases', () => {
  // ---------------------------------------------------------------------------
  // unregister()
  // ---------------------------------------------------------------------------

  describe('unregister', () => {
    it('removes a registered tool', () => {
      const registry = new ToolRegistry();
      const tool: Tool = {
        name: 'temp',
        description: 'Temporary',
        inputSchema: z.object({}),
        execute: async () => 'temp',
      };
      registry.register(tool);
      expect(registry.get('temp')).toBeDefined();

      const removed = registry.unregister('temp');
      expect(removed).toBe(true);
      expect(registry.get('temp')).toBeUndefined();
    });

    it('returns false for non-existent tool', () => {
      const registry = new ToolRegistry();
      expect(registry.unregister('ghost')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // toAiSdkToolSchemas()
  // ---------------------------------------------------------------------------

  describe('toAiSdkToolSchemas', () => {
    it('returns schema-only definitions without execute function', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'read_file',
        description: 'Read a file',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => `content of ${path}`,
      });

      const schemas = registry.toAiSdkToolSchemas();
      expect(schemas.read_file).toBeDefined();
      expect(schemas.read_file.description).toBe('Read a file');
      expect(schemas.read_file.inputSchema).toBeDefined();
      expect((schemas.read_file as any).execute).toBeUndefined();
    });

    it('returns empty object when no tools registered', () => {
      const registry = new ToolRegistry();
      expect(Object.keys(registry.toAiSdkToolSchemas())).toHaveLength(0);
    });

    it('wraps plain JSON Schema objects via jsonSchema()', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'mcp_tool',
        description: 'MCP tool with JSON schema',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        } as any,
        execute: async ({ query }) => `result: ${query}`,
      });

      const schemas = registry.toAiSdkToolSchemas();
      expect(schemas.mcp_tool.inputSchema).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // executeTool()
  // ---------------------------------------------------------------------------

  describe('executeTool', () => {
    it('returns error result for unregistered tool', async () => {
      const registry = new ToolRegistry();
      const result = await registry.executeTool('nonexistent', {});
      expect(result.error).toContain('not found');
      expect(result.output).toBeUndefined();
    });

    it('executes tool and returns result', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'add',
        description: 'Add numbers',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => (a as number) + (b as number),
      });

      const result = await registry.executeTool('add', { a: 3, b: 4 });
      expect(result.output).toBe(7);
      expect(result.error).toBeUndefined();
    });

    it('returns error on validation failure instead of throwing', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'strict',
        description: 'Strict tool',
        inputSchema: z.object({ count: z.number() }),
        execute: async ({ count }) => `count: ${count}`,
      });

      const result = await registry.executeTool('strict', { count: 'not-a-number' });
      expect(result.error).toContain('Input validation failed');
      expect(result.output).toBeUndefined();
    });

    it('returns error when tool execute throws', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'crash',
        description: 'Crashes',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('Tool exploded'); },
      });

      const result = await registry.executeTool('crash', {});
      expect(result.error).toBe('Tool exploded');
    });

    it('passes toolCallId from context', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'id_tool',
        description: 'Echoes id',
        inputSchema: z.object({}),
        execute: async () => 'ok',
      });

      const result = await registry.executeTool('id_tool', {}, { toolCallId: 'call-123' });
      expect(result.toolCallId).toBe('call-123');
    });

    it('calls before hooks', async () => {
      const calls: string[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'hooked',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'result',
      });
      registry.addBeforeHook(async (ctx) => {
        calls.push(`before:${ctx.toolName}`);
      });

      await registry.executeTool('hooked', {});
      expect(calls).toEqual(['before:hooked']);
    });

    it('calls after hooks on success', async () => {
      const calls: string[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'hooked',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'result',
      });
      registry.addAfterHook(async (ctx) => {
        calls.push(`after:${ctx.toolName}:${ctx.result}`);
      });

      await registry.executeTool('hooked', {});
      expect(calls).toEqual(['after:hooked:result']);
    });

    it('calls after hooks on failure with error', async () => {
      const calls: string[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'fail',
        description: 'Fails',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('boom'); },
      });
      registry.addAfterHook(async (ctx) => {
        calls.push(`after:${ctx.toolName}:error=${ctx.error?.message}`);
      });

      const result = await registry.executeTool('fail', {});
      expect(result.error).toBe('boom');
      expect(calls).toEqual(['after:fail:error=boom']);
    });
  });

  // ---------------------------------------------------------------------------
  // Truncation edge cases
  // ---------------------------------------------------------------------------

  describe('truncation', () => {
    it('handles null output without crashing', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'null_tool',
        description: 'Returns null',
        inputSchema: z.object({}),
        execute: async () => null,
      });

      const result = await registry.toAiSdkTools().null_tool.execute!({});
      expect(result).toBeNull();
    });

    it('handles undefined output without crashing', async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'undef_tool',
        description: 'Returns undefined',
        inputSchema: z.object({}),
        execute: async () => undefined,
      });

      const result = await registry.toAiSdkTools().undef_tool.execute!({});
      expect(result).toBeUndefined();
    });

    it('handles non-serializable objects (circular references)', async () => {
      const registry = new ToolRegistry({ maxOutputLength: 100 });
      registry.register({
        name: 'circular',
        description: 'Returns circular ref',
        inputSchema: z.object({}),
        execute: async () => {
          const obj: any = { name: 'circular' };
          obj.self = obj;
          return obj;
        },
      });

      const result = await registry.toAiSdkTools().circular.execute!({}) as any;
      expect(result.truncated).toBe(true);
    });

    it('passes through evicted objects without re-truncation', async () => {
      const registry = new ToolRegistry({ maxOutputLength: 5 });
      registry.register({
        name: 'evicted',
        description: 'Returns evicted marker',
        inputSchema: z.object({}),
        execute: async () => ({ evicted: true, preview: 'short', ref: 'storage-key' }),
      });

      const result = await registry.toAiSdkTools().evicted.execute!({}) as any;
      expect(result.evicted).toBe(true);
      expect(result.truncated).toBeUndefined();
    });

    it('handles maxOutputLength of 0', async () => {
      const registry = new ToolRegistry({ maxOutputLength: 0 });
      registry.register({
        name: 'zero',
        description: 'Any output',
        inputSchema: z.object({}),
        execute: async () => 'hello',
      });

      const result = await registry.toAiSdkTools().zero.execute!({});
      expect(result).toBe('... [truncated]');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple hooks
  // ---------------------------------------------------------------------------

  describe('hook chaining', () => {
    it('runs multiple before hooks in order', async () => {
      const order: number[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'chain',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'ok',
      });
      registry.addBeforeHook(async () => { order.push(1); });
      registry.addBeforeHook(async () => { order.push(2); });

      await registry.executeTool('chain', {});
      expect(order).toEqual([1, 2]);
    });

    it('runs multiple after hooks in order', async () => {
      const order: number[] = [];
      const registry = new ToolRegistry();
      registry.register({
        name: 'chain',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'ok',
      });
      registry.addAfterHook(async () => { order.push(1); });
      registry.addAfterHook(async () => { order.push(2); });

      await registry.executeTool('chain', {});
      expect(order).toEqual([1, 2]);
    });
  });
});
