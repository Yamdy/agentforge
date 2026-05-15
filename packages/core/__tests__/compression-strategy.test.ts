import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../src/context-builder.js';
import type { PipelineContext, Message, CompressionStrategy } from '@agentforge/sdk';
import type { ToolRegistry } from '../src/tool-registry.js';

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
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {}, messageHistory: history },
    ...overrides,
  };
}

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `message ${i}`,
  }));
}

describe('ContextBuilder default semantic truncation', () => {
  it('trims history to fit budget, preserving recent messages', async () => {
    const cb = new ContextBuilder({ registry: makeMockRegistry(), budget: { maxTokens: 100 } });
    const processor = cb.createProcessor();
    const history = makeMessages(60);
    const ctx = makeContext(history, {
      agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
    });
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.messageHistory!.length).toBeLessThan(60);
    expect(result.session.messageHistory!.length).toBeGreaterThan(0);
  });

  it('returns all messages when under budget', async () => {
    const cb = new ContextBuilder({ registry: makeMockRegistry(), budget: { maxTokens: 10000 } });
    const processor = cb.createProcessor();
    const history = makeMessages(10);
    const ctx = makeContext(history);
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(10);
  });

  it('returns ctx unchanged when messageHistory is undefined', async () => {
    const cb = new ContextBuilder({ registry: makeMockRegistry() });
    const processor = cb.createProcessor();
    const ctx = makeContext(undefined);
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.messageHistory).toBeUndefined();
  });

  it('returns ctx unchanged when messageHistory is empty', async () => {
    const cb = new ContextBuilder({ registry: makeMockRegistry() });
    const processor = cb.createProcessor();
    const ctx = makeContext([]);
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(0);
  });
});

describe('ContextBuilder with custom CompressionStrategy', () => {
  it('applies custom strategy', async () => {
    const keep3: CompressionStrategy = (msgs) => msgs.slice(-3);
    const cb = new ContextBuilder({ registry: makeMockRegistry(), compressionStrategy: keep3, budget: { maxTokens: 100 } });
    const processor = cb.createProcessor();
    const history = makeMessages(20);
    const ctx = makeContext(history);
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(3);
  });

  it('supports async CompressionStrategy', async () => {
    const asyncStrategy: CompressionStrategy = async (msgs) => {
      await Promise.resolve();
      return msgs.slice(-3);
    };
    const cb = new ContextBuilder({ registry: makeMockRegistry(), compressionStrategy: asyncStrategy, budget: { maxTokens: 10 } });
    const processor = cb.createProcessor();
    const history = makeMessages(10);
    const ctx = makeContext(history);
    const result = await processor.execute(ctx) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(3);
  });

  it('receives TokenCounter and budget in strategy', async () => {
    let receivedTc = false;
    let receivedBudget = false;
    const strategy: CompressionStrategy = (msgs, tc, budget) => {
      receivedTc = typeof tc.count === 'function';
      receivedBudget = typeof budget === 'number';
      return msgs.slice(-3);
    };
    const cb = new ContextBuilder({
      registry: makeMockRegistry(),
      compressionStrategy: strategy,
      budget: { maxTokens: 10 },
    });
    const processor = cb.createProcessor();
    const history = makeMessages(10);
    const ctx = makeContext(history);
    await processor.execute(ctx);
    expect(receivedTc).toBe(true);
    expect(receivedBudget).toBe(true);
  });
});
