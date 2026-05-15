import { describe, it, expect } from 'vitest';
import { createTokenBudgetProcessor } from '../src/harness/token-budget-processor.js';
import type { PipelineContext, ProcessorResult } from '@agentforge/sdk';

function makeContext(history?: Array<{ role: 'user'; content: string }>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: {
      config: { model: 'mock/test' },
      promptFragments: [],
      toolDeclarations: [],
      systemPrompt: 'You are helpful.',
    },
    iteration: { step: 0 },
    session: { messageHistory: history ?? [], custom: {} },
  } as PipelineContext;
}

function isAbort(r: ProcessorResult): r is { type: 'abort'; reason: string } {
  return 'type' in r && (r as any).type === 'abort';
}

function isContext(r: ProcessorResult): r is PipelineContext {
  return 'request' in r && 'agent' in r;
}

describe('TokenBudgetProcessor', () => {
  it('allows when within budget', async () => {
    const processor = createTokenBudgetProcessor({
      maxContextTokens: 100_000,
      reservedOutputTokens: 4096,
      strategy: 'block',
    });
    const result = await processor.execute(makeContext());
    expect(isContext(result)).toBe(true);
  });

  it('blocks when budget exceeded with block strategy', async () => {
    const longHistory = Array.from({ length: 5000 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(100),
    }));
    const processor = createTokenBudgetProcessor({
      maxContextTokens: 1000,
      reservedOutputTokens: 256,
      strategy: 'block',
    });
    const result = await processor.execute(makeContext(longHistory));
    expect(isAbort(result)).toBe(true);
    if (isAbort(result)) {
      expect(result.reason).toContain('Token budget exceeded');
    }
  });

  it('truncates history with truncate strategy', async () => {
    const longHistory = Array.from({ length: 100 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(100),
    }));
    const processor = createTokenBudgetProcessor({
      maxContextTokens: 500,
      reservedOutputTokens: 100,
      strategy: 'truncate',
    });
    const result = await processor.execute(makeContext(longHistory));
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.session.messageHistory!.length).toBeLessThan(longHistory.length);
    }
  });

  it('flags overrun with compress strategy', async () => {
    const longHistory = Array.from({ length: 5000 }, () => ({
      role: 'user' as const,
      content: 'x'.repeat(100),
    }));
    const processor = createTokenBudgetProcessor({
      maxContextTokens: 1000,
      reservedOutputTokens: 256,
      strategy: 'compress',
    });
    const result = await processor.execute(makeContext(longHistory));
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.session.custom.tokenBudgetOverrun).toBe(true);
    }
  });
});
