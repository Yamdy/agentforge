import { describe, it, expect } from 'vitest';
import { createTokenBudgetProcessor } from '../src/harness/token-budget-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

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

function makeProcessorContext(history?: Array<{ role: 'user'; content: string }>): ProcessorContext {
  return new ProcessorContextImpl(makeContext(history));
}

async function expectAbort(pCtx: ProcessorContext, processor: { execute: (ctx: ProcessorContext) => Promise<unknown> }): Promise<string> {
  try {
    await processor.execute(pCtx);
    throw new Error('Expected abort but processor returned normally');
  } catch (error) {
    if (error instanceof AbortControlFlow) {
      return error.reason;
    }
    throw error;
  }
}

describe('TokenBudgetProcessor', () => {
  it('allows when within budget', async () => {
    const processor = createTokenBudgetProcessor({
      maxContextTokens: 100_000,
      reservedOutputTokens: 4096,
      strategy: 'block',
    });
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    // No abort = allowed
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
    const pCtx = makeProcessorContext(longHistory);
    const reason = await expectAbort(pCtx, processor);
    expect(reason).toContain('Token budget exceeded');
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
    const pCtx = makeProcessorContext(longHistory);
    await processor.execute(pCtx);
    expect(pCtx.state.session.messageHistory!.length).toBeLessThan(longHistory.length);
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
    const pCtx = makeProcessorContext(longHistory);
    await processor.execute(pCtx);
    expect(pCtx.state.session.custom.tokenBudgetOverrun).toBe(true);
  });
});
