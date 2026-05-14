import { describe, it, expect } from 'vitest';
import { slidingWindowStrategy, createPrepareStepProcessor } from '../src/processors/prepare-step.js';
import type { PipelineContext, Message, CompressionStrategy } from '@agentforge/sdk';

function makeContext(history?: Message[]): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {}, messageHistory: history },
  };
}

function makeMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'user' as const,
    content: `message ${i}`,
  }));
}

describe('slidingWindowStrategy', () => {
  it('keeps last N messages when history exceeds limit', () => {
    const strategy = slidingWindowStrategy({ keepRecent: 3 });
    const messages = makeMessages(10);
    const result = strategy(messages) as Message[];
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('message 7');
    expect(result[2].content).toBe('message 9');
  });

  it('returns all messages when under limit', () => {
    const strategy = slidingWindowStrategy({ keepRecent: 50 });
    const messages = makeMessages(10);
    expect(strategy(messages) as Message[]).toHaveLength(10);
  });

  it('returns all messages when exactly at limit', () => {
    const strategy = slidingWindowStrategy({ keepRecent: 10 });
    const messages = makeMessages(10);
    expect(strategy(messages) as Message[]).toHaveLength(10);
  });

  it('defaults to keepRecent=50', () => {
    const strategy = slidingWindowStrategy();
    const messages = makeMessages(60);
    expect(strategy(messages) as Message[]).toHaveLength(50);
  });

  it('throws on keepRecent=0', () => {
    expect(() => slidingWindowStrategy({ keepRecent: 0 })).toThrow(RangeError);
  });

  it('throws on negative keepRecent', () => {
    expect(() => slidingWindowStrategy({ keepRecent: -5 })).toThrow(RangeError);
  });

  it('works with keepRecent=1', () => {
    const strategy = slidingWindowStrategy({ keepRecent: 1 });
    const messages = makeMessages(10);
    const result = strategy(messages) as Message[];
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('message 9');
  });
});

describe('createPrepareStepProcessor', () => {
  it('uses default sliding window of 50 when no strategy provided', async () => {
    const processor = createPrepareStepProcessor();
    const history = makeMessages(60);
    const ctx = makeContext(history);
    const result = (await processor.execute(ctx)) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(50);
  });

  it('uses provided CompressionStrategy', async () => {
    const customStrategy: CompressionStrategy = (msgs) => msgs.slice(-5);
    const processor = createPrepareStepProcessor(customStrategy);
    const history = makeMessages(20);
    const ctx = makeContext(history);
    const result = (await processor.execute(ctx)) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(5);
  });

  it('supports async CompressionStrategy', async () => {
    const asyncStrategy: CompressionStrategy = async (msgs) => {
      await Promise.resolve();
      return msgs.slice(-3);
    };
    const processor = createPrepareStepProcessor(asyncStrategy);
    const history = makeMessages(10);
    const ctx = makeContext(history);
    const result = (await processor.execute(ctx)) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(3);
  });

  it('returns ctx unchanged when messageHistory is undefined', async () => {
    const processor = createPrepareStepProcessor();
    const ctx = makeContext(undefined);
    const result = (await processor.execute(ctx)) as PipelineContext;
    expect(result.session.messageHistory).toBeUndefined();
  });

  it('returns ctx unchanged when messageHistory is empty', async () => {
    const processor = createPrepareStepProcessor();
    const ctx = makeContext([]);
    const result = (await processor.execute(ctx)) as PipelineContext;
    expect(result.session.messageHistory).toHaveLength(0);
  });

  it('preserves non-history context fields', async () => {
    const processor = createPrepareStepProcessor();
    const history = makeMessages(60);
    const ctx = makeContext(history);
    ctx.session.custom = { key: 'value' };
    ctx.session.totalTokenUsage = { input: 100, output: 50 };
    const result = (await processor.execute(ctx)) as PipelineContext;
    expect(result.session.custom).toEqual({ key: 'value' });
    expect(result.session.totalTokenUsage).toEqual({ input: 100, output: 50 });
    expect(result.request.sessionId).toBe('s1');
  });
});
