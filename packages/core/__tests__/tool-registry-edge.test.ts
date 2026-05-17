import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { Tool } from '@primo-ai/sdk';
import { ToolRegistry } from '../src/tool-registry.js';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';

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
      expect((schemas.read_file as { execute?: unknown }).execute).toBeUndefined();
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
        } as unknown,
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

    it('calls tool.before hook via HookManager', async () => {
      const calls: string[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({ point: 'tool.before', handler: (input) => { calls.push(`before:${(input as Record<string, unknown>).toolName}`); } });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'hooked',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'result',
      });

      await registry.executeTool('hooked', {});
      expect(calls).toEqual(['before:hooked']);
    });

    it('calls tool.after hook on success via HookManager', async () => {
      const calls: string[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({ point: 'tool.after', handler: (input, output) => { calls.push(`after:${(input as Record<string, unknown>).toolName}:${(output as Record<string, unknown>).result}`); } });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'hooked',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'result',
      });

      await registry.executeTool('hooked', {});
      expect(calls).toEqual(['after:hooked:result']);
    });

    it('calls tool.after hook on failure with error via HookManager', async () => {
      const calls: string[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({ point: 'tool.after', handler: (input, output) => { calls.push(`after:${(input as Record<string, unknown>).toolName}:error=${(output as Record<string, unknown>).error}`); } });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'fail',
        description: 'Fails',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('boom'); },
      });

      const result = await registry.executeTool('fail', {});
      expect(result.error).toBe('boom');
      expect(calls).toEqual(['after:fail:error=boom']);
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple hooks
  // ---------------------------------------------------------------------------

  describe('hook chaining', () => {
    it('runs multiple tool.before hooks in order via HookManager', async () => {
      const order: number[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({ point: 'tool.before', handler: () => { order.push(1); }, priority: 1 });
      hookManager.register({ point: 'tool.before', handler: () => { order.push(2); }, priority: 2 });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'chain',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'ok',
      });

      await registry.executeTool('chain', {});
      expect(order).toEqual([1, 2]);
    });

    it('runs multiple tool.after hooks in order via HookManager', async () => {
      const order: number[] = [];
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({ point: 'tool.after', handler: () => { order.push(1); }, priority: 1 });
      hookManager.register({ point: 'tool.after', handler: () => { order.push(2); }, priority: 2 });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.register({
        name: 'chain',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'ok',
      });

      await registry.executeTool('chain', {});
      expect(order).toEqual([1, 2]);
    });
  });

  // ---------------------------------------------------------------------------
  // F-5: tool:output_mutated observability
  // ---------------------------------------------------------------------------

  describe('output mutation policy', () => {
    it('blocks hook from mutating output when tool lacks allowOutputMutation', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      const eventBus = new EventBus();
      eventBus.subscribe('tool:output_blocked', (data) => {
        events.push({ type: 'tool:output_blocked', data });
      });

      const hookManager = new HookManager(eventBus);
      hookManager.register({
        point: 'tool.after',
        handler: (_input, output) => {
          (output as Record<string, unknown>).result = 'MUTATED';
        },
      });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.setEventBus(eventBus);
      // Tool WITHOUT allowOutputMutation — mutation should be blocked
      registry.register({
        name: 'protected_tool',
        description: 'Protected',
        inputSchema: z.object({}),
        execute: async () => 'original',
      });

      const result = await registry.executeTool('protected_tool', {});
      // Output should remain unchanged
      expect(result.output).toBe('original');
      // Should emit a blocked event
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({
        toolName: 'protected_tool',
        original: 'original',
        attempted: 'MUTATED',
      });
    });

    it('allows hook to mutate output when tool declares allowOutputMutation', async () => {
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      hookManager.register({
        point: 'tool.after',
        handler: (_input, output) => {
          (output as Record<string, unknown>).result = 'HOOKED';
        },
      });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.setEventBus(eventBus);
      registry.register({
        name: 'open_tool',
        description: 'Open',
        inputSchema: z.object({}),
        execute: async () => 'original',
        allowOutputMutation: true,
      });

      const result = await registry.executeTool('open_tool', {});
      expect(result.output).toBe('HOOKED');
      expect(result.mutated).toBe(true);
    });
  });

  describe('output mutation tracking', () => {
    it('emits tool:output_mutated when hook changes result', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      const eventBus = new EventBus();
      eventBus.subscribe('tool:output_mutated', (data) => {
        events.push({ type: 'tool:output_mutated', data });
      });

      const hookManager = new HookManager(eventBus);
      hookManager.register({
        point: 'tool.after',
        handler: (_input, output) => {
          (output as Record<string, unknown>).result = 'HOOKED';
        },
      });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.setEventBus(eventBus);
      registry.register({
        name: 'mutate_me',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'original',
        allowOutputMutation: true,
      });

      const result = await registry.executeTool('mutate_me', {});
      expect(result.output).toBe('HOOKED');
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({
        toolName: 'mutate_me',
        original: 'original',
        mutated: 'HOOKED',
      });
    });

    it('does not emit tool:output_mutated when hook does not change result', async () => {
      const events: Array<{ type: string; data: unknown }> = [];
      const eventBus = new EventBus();
      eventBus.subscribe('tool:output_mutated', (data) => {
        events.push({ type: 'tool:output_mutated', data });
      });

      const hookManager = new HookManager(eventBus);
      hookManager.register({
        point: 'tool.after',
        handler: () => {},
      });

      const registry = new ToolRegistry();
      registry.setHookManager(hookManager);
      registry.setEventBus(eventBus);
      registry.register({
        name: 'no_mutate',
        description: 'Test',
        inputSchema: z.object({}),
        execute: async () => 'original',
      });

      const result = await registry.executeTool('no_mutate', {});
      expect(result.output).toBe('original');
      expect(events).toHaveLength(0);
    });
  });
});
