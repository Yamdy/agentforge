import { describe, it, expect, vi } from 'vitest';
import { ContextBuilder } from '../src/context-builder.js';
import { ProcessorContextImpl } from '../src/processor-context.js';
import type { PipelineContext, Message, CompressionStrategy, ProcessorContext, TokenCounter } from '@primo-ai/sdk';
import type { ToolRegistry } from '../src/tool-registry.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMockRegistry(): ToolRegistry {
  return {
    getAll: () => [],
    register: () => {},
    unregister: () => false,
    get: () => undefined,
    setHookManager: () => {},
    setEventBus: () => {},
  } as unknown as ToolRegistry;
}

function makeContext(history?: Message[], overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 's1', custom: {}, messageHistory: history },
    ...overrides,
  };
}

function makeProcessorContext(history?: Message[], overrides?: Partial<PipelineContext>): ProcessorContext {
  return new ProcessorContextImpl(makeContext(history, overrides));
}

function makeMessages(count: number, contentPrefix = 'message'): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `${contentPrefix} ${i} `.repeat(10), // make each message substantial
  }));
}

// ---------------------------------------------------------------------------
// F-8: In-loop context compression tests
// ---------------------------------------------------------------------------

describe('F-8: In-loop context compression', () => {
  describe('ContextBuilder.compressIfNeeded (public trimHistory)', () => {
    it('compresses history when over threshold', async () => {
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 200 }, // very small budget
      });
      const history = makeMessages(50);
      const ctx = makeContext(history);

      const result = await cb.compressIfNeeded(ctx);

      // History should be compressed
      expect(result.session.messageHistory!.length).toBeLessThan(50);
      expect(result.session.messageHistory!.length).toBeGreaterThan(0);
    });

    it('does not compress when under budget', async () => {
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 1_000_000 }, // huge budget
      });
      const history = makeMessages(5);
      const ctx = makeContext(history);

      const result = await cb.compressIfNeeded(ctx);

      expect(result.session.messageHistory).toHaveLength(5);
    });

    it('returns ctx unchanged when messageHistory is undefined', async () => {
      const cb = new ContextBuilder({ registry: makeMockRegistry() });
      const ctx = makeContext(undefined);

      const result = await cb.compressIfNeeded(ctx);

      expect(result.session.messageHistory).toBeUndefined();
    });

    it('returns ctx unchanged when messageHistory is empty', async () => {
      const cb = new ContextBuilder({ registry: makeMockRegistry() });
      const ctx = makeContext([]);

      const result = await cb.compressIfNeeded(ctx);

      expect(result.session.messageHistory).toHaveLength(0);
    });

    it('uses the configured compressionStrategy', async () => {
      const customStrategy: CompressionStrategy = vi.fn((msgs: Message[]) => msgs.slice(-2));
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        compressionStrategy: customStrategy,
        budget: { maxTokens: 100 },
      });
      const history = makeMessages(20);
      const ctx = makeContext(history);

      const result = await cb.compressIfNeeded(ctx);

      expect(customStrategy).toHaveBeenCalled();
      expect(result.session.messageHistory).toHaveLength(2);
    });

    it('preserves other session fields when compressing', async () => {
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 200 },
      });
      const history = makeMessages(50);
      const ctx = makeContext(history, {
        session: {
          input: 'test',
          sessionId: 's1',
          custom: { key: 'value' },
          messageHistory: history,
          totalTokenUsage: { input: 100, output: 50 },
        },
      });

      const result = await cb.compressIfNeeded(ctx);

      expect(result.session.sessionId).toBe('s1');
      expect(result.session.input).toBe('test');
      expect(result.session.custom).toEqual({ key: 'value' });
      expect(result.session.totalTokenUsage).toEqual({ input: 100, output: 50 });
    });
  });

  describe('createCompressContextProcessor', () => {
    it('creates a processor for the compressContext stage', async () => {
      const { createCompressContextProcessor } = await import('../src/processors/compress-context.js');
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 1_000_000 },
      });
      const processor = createCompressContextProcessor(cb);
      expect(processor.stage).toBe('compressContext');
    });

    it('compresses history via ContextBuilder when history exceeds budget', async () => {
      const { createCompressContextProcessor } = await import('../src/processors/compress-context.js');
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 200 },
      });
      const processor = createCompressContextProcessor(cb);
      const history = makeMessages(50);
      const pCtx = makeProcessorContext(history);

      await processor.execute(pCtx);

      expect(pCtx.state.session.messageHistory!.length).toBeLessThan(50);
    });

    it('does not modify history when under budget', async () => {
      const { createCompressContextProcessor } = await import('../src/processors/compress-context.js');
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 1_000_000 },
      });
      const processor = createCompressContextProcessor(cb);
      const history = makeMessages(5);
      const pCtx = makeProcessorContext(history);

      await processor.execute(pCtx);

      expect(pCtx.state.session.messageHistory).toHaveLength(5);
    });

    it('emits context:compressed event when compression occurs', async () => {
      const { createCompressContextProcessor } = await import('../src/processors/compress-context.js');
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 200 },
      });

      const events: Array<{ event: string; data: unknown }> = [];
      const mockEventBus = {
        emit: (event: string, data: unknown) => { events.push({ event, data }); },
      };

      const processor = createCompressContextProcessor(cb, mockEventBus as any);
      const history = makeMessages(50);
      const pCtx = makeProcessorContext(history);

      await processor.execute(pCtx);

      expect(events.some(e => e.event === 'context:compressed')).toBe(true);
      const compressedEvent = events.find(e => e.event === 'context:compressed');
      expect(compressedEvent?.data).toHaveProperty('step');
      expect(compressedEvent?.data).toHaveProperty('beforeCount');
      expect(compressedEvent?.data).toHaveProperty('afterCount');
    });

    it('does not emit context:compressed when no compression needed', async () => {
      const { createCompressContextProcessor } = await import('../src/processors/compress-context.js');
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 1_000_000 },
      });

      const events: Array<{ event: string; data: unknown }> = [];
      const mockEventBus = {
        emit: (event: string, data: unknown) => { events.push({ event, data }); },
      };

      const processor = createCompressContextProcessor(cb, mockEventBus as any);
      const history = makeMessages(5);
      const pCtx = makeProcessorContext(history);

      await processor.execute(pCtx);

      expect(events.some(e => e.event === 'context:compressed')).toBe(false);
    });

    it('acts on tokenBudgetOverrun flag from TokenBudgetProcessor', async () => {
      const { createCompressContextProcessor } = await import('../src/processors/compress-context.js');
      const cb = new ContextBuilder({
        registry: makeMockRegistry(),
        budget: { maxTokens: 1_000_000 }, // huge budget so normal trimHistory won't trigger
      });

      // Set the tokenBudgetOverrun flag as TokenBudgetProcessor does
      const events: Array<{ event: string; data: unknown }> = [];
      const mockEventBus = {
        emit: (event: string, data: unknown) => { events.push({ event, data }); },
      };

      const processor = createCompressContextProcessor(cb, mockEventBus as any);
      const history = makeMessages(20);
      const pCtx = makeProcessorContext(history, {
        session: {
          input: 'test',
          sessionId: 's1',
          custom: { tokenBudgetOverrun: true },
          messageHistory: history,
        },
      });

      await processor.execute(pCtx);

      // Even though budget is huge, the tokenBudgetOverrun flag should force compression
      expect(events.some(e => e.event === 'context:compressed')).toBe(true);
    });
  });
});
