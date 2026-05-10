import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEvictionStorage } from '../src/eviction/eviction-storage.js';
import { evictionPlugin } from '../src/eviction/eviction-plugin.js';
import type { HarnessAPI, PluginRegistration, EvictionStorage, ToolWrapContext } from '@agentforge/sdk';

describe('InMemoryEvictionStorage', () => {
  let storage: InMemoryEvictionStorage;

  beforeEach(() => {
    storage = new InMemoryEvictionStorage();
  });

  it('stores content and returns a reference string', async () => {
    const ref = await storage.store('session-1', 'tool:read_file', { path: '/etc/config', content: 'secret' });
    expect(typeof ref).toBe('string');
    expect(ref.length).toBeGreaterThan(0);
  });

  it('retrieves stored content by reference', async () => {
    const original = { path: '/etc/config', content: 'secret' };
    const ref = await storage.store('session-1', 'tool:read_file', original);
    const retrieved = await storage.retrieve('session-1', ref);
    expect(retrieved).toEqual(original);
  });

  it('returns different references for different keys', async () => {
    const ref1 = await storage.store('session-1', 'tool:a', 'data-a');
    const ref2 = await storage.store('session-1', 'tool:b', 'data-b');
    expect(ref1).not.toBe(ref2);
    expect(await storage.retrieve('session-1', ref1)).toBe('data-a');
    expect(await storage.retrieve('session-1', ref2)).toBe('data-b');
  });
});

describe('evictionPlugin', () => {
  function createHarnessAPI(): {
    api: HarnessAPI;
    hooks: Map<string, unknown[]>;
  } {
    const hooks = new Map<string, unknown[]>();
    const api: HarnessAPI = {
      registerProcessor: () => {},
      registerTool: () => {},
      registerCommand: () => {},
      registerHook: (hook) => {
        let list = hooks.get(hook.point);
        if (!list) { list = []; hooks.set(hook.point, list); }
        list.push(hook.handler);
      },
      subscribe: () => () => {},
      registerResource: () => {},
      registerProvider: () => {},
    };
    return { api, hooks };
  }

  it('registers a tool.wrap hook', () => {
    const storage = new InMemoryEvictionStorage();
    const { api, hooks } = createHarnessAPI();

    evictionPlugin({ maxSize: 10, storage })(api);
    expect(hooks.has('tool.wrap')).toBe(true);
    expect(hooks.get('tool.wrap')!.length).toBe(1);
  });

  it('evicts large tool output and replaces with preview + reference', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, hooks } = createHarnessAPI();

    evictionPlugin({ maxSize: 100, storage, previewLength: 100 })(api);

    const handler = hooks.get('tool.wrap')![0] as (ctx: ToolWrapContext) => Promise<unknown>;
    const largeContent = 'x'.repeat(500);
    const ctx: ToolWrapContext = {
      toolName: 'read_file',
      args: { path: '/tmp/log.txt' },
      result: largeContent,
      sessionId: 'session-1',
    };

    const result = await handler(ctx) as ToolWrapContext;
    expect(result).not.toBeUndefined();
    expect(result.result).toMatchObject({
      preview: expect.any(String),
      reference: expect.any(String),
      evicted: true,
    });
    const evicted = result.result as { preview: string; reference: string; evicted: true };
    expect(evicted.preview.length).toBeLessThan(largeContent.length);

    // Verify content is retrievable
    const retrieved = await storage.retrieve('session-1', evicted.reference);
    expect(retrieved).toBe(largeContent);
  });

  it('passes through small tool output unchanged', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, hooks } = createHarnessAPI();

    evictionPlugin({ maxSize: 1000, storage })(api);

    const handler = hooks.get('tool.wrap')![0] as (ctx: ToolWrapContext) => Promise<unknown>;
    const ctx: ToolWrapContext = {
      toolName: 'echo',
      args: { message: 'hello' },
      result: 'short result',
      sessionId: 'session-2',
    };

    const result = await handler(ctx);
    expect(result).toBeUndefined();
  });

  it('handles null and undefined results without crashing', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, hooks } = createHarnessAPI();
    evictionPlugin({ maxSize: 10, storage })(api);
    const handler = hooks.get('tool.wrap')![0] as (ctx: ToolWrapContext) => Promise<unknown>;

    const nullCtx: ToolWrapContext = {
      toolName: 'test', args: {}, result: null, sessionId: 's1',
    };
    expect(await handler(nullCtx)).toBeUndefined();

    const undefCtx: ToolWrapContext = {
      toolName: 'test', args: {}, result: undefined, sessionId: 's1',
    };
    expect(await handler(undefCtx)).toBeUndefined();
  });

  it('evicts large non-string (object) results', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, hooks } = createHarnessAPI();
    evictionPlugin({ maxSize: 50, storage, previewLength: 50 })(api);
    const handler = hooks.get('tool.wrap')![0] as (ctx: ToolWrapContext) => Promise<unknown>;

    const largeObj = { users: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `user-${i}` })) };
    const ctx: ToolWrapContext = {
      toolName: 'list_users',
      args: {},
      result: largeObj,
      sessionId: 'session-3',
    };

    const result = await handler(ctx) as ToolWrapContext;
    expect(result).not.toBeUndefined();
    const evicted = result.result as { preview: string; reference: string; evicted: true };
    expect(evicted.evicted).toBe(true);
    expect(evicted.preview.length).toBeLessThanOrEqual(60); // previewLength + brackets

    // Verify the original object is retrievable
    const retrieved = await storage.retrieve('session-3', evicted.reference);
    expect(retrieved).toEqual(largeObj);
  });
});
