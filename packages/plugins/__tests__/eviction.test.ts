import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEvictionStorage } from '../src/eviction/eviction-storage.js';
import { evictionPlugin } from '../src/eviction/eviction-plugin.js';
import type { HarnessAPI, Processor, PipelineContext } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '@primo-ai/core';

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
    processors: Processor[];
  } {
    const processors: Processor[] = [];
    const api: HarnessAPI = {
      registerProcessor: (_stage, processor) => {
        processors.push(processor);
      },
      registerTool: () => {},
      unregisterTool: () => false,
      registerCommand: () => {},
      registerHook: () => {},
      subscribe: () => () => {},
      registerResource: () => {},
      registerProvider: () => {},
    };
    return { api, processors };
  }

  function makeCtx(toolResults: Array<{ toolCallId: string; name: string; output: unknown }>): PipelineContext {
    return {
      agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
      iteration: { step: 0, toolResults },
      session: { input: 'test', sessionId: 'session-1', custom: {} },
    };
  }

  async function executeProcessor(processor: Processor, ctx: PipelineContext): Promise<PipelineContext> {
    const pCtx = new ProcessorContextImpl(ctx);
    await processor.execute(pCtx);
    return pCtx.state;
  }

  it('registers an executeTools processor', () => {
    const storage = new InMemoryEvictionStorage();
    const { api, processors } = createHarnessAPI();

    evictionPlugin({ maxSize: 10, storage })(api);
    expect(processors.length).toBe(1);
    expect(processors[0]!.stage).toBe('executeTools');
  });

  it('evicts large tool output and replaces with preview + reference', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, processors } = createHarnessAPI();

    evictionPlugin({ maxSize: 100, storage, previewLength: 100 })(api);

    const largeContent = 'x'.repeat(500);
    const ctx = makeCtx([
      { toolCallId: 'tc1', name: 'read_file', output: largeContent },
    ]);

    const processor = processors[0]!;
    const result = await executeProcessor(processor, ctx);

    const evicted = result.iteration.toolResults![0]!.output as { preview: string; reference: string; evicted: true };
    expect(evicted.evicted).toBe(true);
    expect(evicted.preview.length).toBeLessThan(largeContent.length);

    const retrieved = await storage.retrieve('session-1', evicted.reference);
    expect(retrieved).toBe(largeContent);
  });

  it('passes through small tool output unchanged', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, processors } = createHarnessAPI();

    evictionPlugin({ maxSize: 1000, storage })(api);

    const ctx = makeCtx([
      { toolCallId: 'tc1', name: 'echo', output: 'short result' },
    ]);

    const processor = processors[0]!;
    const result = await executeProcessor(processor, ctx);

    expect(result.iteration.toolResults![0]!.output).toBe('short result');
  });

  it('handles null and undefined outputs without crashing', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, processors } = createHarnessAPI();
    evictionPlugin({ maxSize: 10, storage })(api);

    const ctx = makeCtx([
      { toolCallId: 'tc1', name: 'test', output: null },
      { toolCallId: 'tc2', name: 'test', output: undefined },
    ]);

    const processor = processors[0]!;
    const result = await executeProcessor(processor, ctx);

    expect(result.iteration.toolResults![0]!.output).toBeNull();
    expect(result.iteration.toolResults![1]!.output).toBeUndefined();
  });

  it('evicts large non-string (object) results', async () => {
    const storage = new InMemoryEvictionStorage();
    const { api, processors } = createHarnessAPI();
    evictionPlugin({ maxSize: 50, storage, previewLength: 50 })(api);

    const largeObj = { users: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `user-${i}` })) };
    const ctx = makeCtx([
      { toolCallId: 'tc1', name: 'list_users', output: largeObj },
    ]);

    const processor = processors[0]!;
    const result = await executeProcessor(processor, ctx);

    const evicted = result.iteration.toolResults![0]!.output as { preview: string; reference: string; evicted: true };
    expect(evicted.evicted).toBe(true);
    expect(evicted.preview.length).toBeLessThanOrEqual(60);

    const retrieved = await storage.retrieve('session-1', evicted.reference);
    expect(retrieved).toEqual(largeObj);
  });
});
