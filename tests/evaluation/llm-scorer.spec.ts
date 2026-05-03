/**
 * Unit tests for src/evaluation/llm-scorer.ts
 *
 * Tests LLMScorer builder validation, evaluate pipeline,
 * weight config, error handling, and boundary values.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMScorer } from '../../src/evaluation/llm-scorer.js';
import type { ScoringContext, ScoringResult } from '../../src/evaluation/types.js';
import type { LLMAdapter, LLMResponse, LLMChunk } from '../../src/core/interfaces.js';
import type { Message } from '../../src/core/state.js';

// ============================================================
// Mock Helpers
// ============================================================

/** Happy-path mock: chat returns a JSON object. */
function createMockLLM(responseOverride?: Partial<LLMResponse>): LLMAdapter {
  return {
    name: 'mock-llm',
    provider: 'mock',
    chat: async () => ({
      content: JSON.stringify({ quality: 'good', score: 0.85 }),
      finishReason: 'stop' as const,
      ...responseOverride,
    }),
    stream: async function* (): AsyncGenerator<LLMChunk> {
      yield { content: '', finishReason: 'stop' };
    },
  };
}

/** Error-path mock: chat always throws. */
function createFailingLLM(): LLMAdapter {
  return {
    name: 'failing-llm',
    provider: 'mock',
    chat: async () => {
      throw new Error('LLM unavailable');
    },
    stream: async function* (): AsyncGenerator<LLMChunk> {
      yield { content: '', finishReason: 'error' };
    },
  };
}

/** Slow LLM mock for timeout simulation. */
function createSlowLLM(delayMs: number): LLMAdapter {
  return {
    name: 'slow-llm',
    provider: 'mock',
    chat: async () => {
      await new Promise(r => setTimeout(r, delayMs));
      return { content: '{}', finishReason: 'stop' };
    },
    stream: async function* (): AsyncGenerator<LLMChunk> {
      yield { content: '', finishReason: 'stop' };
    },
  };
}

/** Minimal valid ScoringContext for testing. */
function createContext(overrides?: Partial<ScoringContext>): ScoringContext {
  return {
    input: 'Hello',
    output: 'Hi there! How can I help?',
    messages: [],
    agentName: 'test-agent',
    sessionId: 'test-session',
    ...overrides,
  };
}

/** Create a ScoringContext with many messages (large context). */
function createLargeContext(messageCount: number): ScoringContext {
  const messages: Message[] = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push({ role: 'user', content: `Message ${i}: `.padEnd(100, 'x') });
    messages.push({ role: 'assistant', content: `Response ${i}: `.padEnd(200, 'y') });
  }
  return createContext({ messages });
}

// ============================================================
// LLMScorer Tests
// ============================================================

describe('LLMScorer', () => {
  let mockLLM: LLMAdapter;

  beforeEach(() => {
    mockLLM = createMockLLM();
  });

  // --------------------------------------------------------
  // Builder — happy path
  // --------------------------------------------------------

  it('builds a scorer with analyze + score steps', () => {
    const scorer = LLMScorer.create({
      id: 'test',
      name: 'Test Scorer',
      description: 'A test scorer',
      judge: mockLLM,
    })
      .analyze(async () => ({}))
      .score(() => 1.0)
      .build();

    expect(scorer).toBeInstanceOf(LLMScorer);
    expect(scorer.weight).toBe(1.0);
  });

  // --------------------------------------------------------
  // Builder — missing required steps
  // --------------------------------------------------------

  it('throws if analyze step is missing', () => {
    const builder = LLMScorer.create({
      id: 'test',
      name: 'Test',
      description: 'Missing analyze',
      judge: mockLLM,
    }).score(() => 0.5);

    expect(() => builder.build()).toThrow(/analyze/);
  });

  it('throws if score step is missing', () => {
    const builder = LLMScorer.create({
      id: 'test',
      name: 'Test',
      description: 'Missing score',
      judge: mockLLM,
    }).analyze(async () => ({}));

    expect(() => builder.build()).toThrow(/score/);
  });

  // --------------------------------------------------------
  // Weight Configuration
  // --------------------------------------------------------

  it('should default weight to 1.0', () => {
    const scorer = LLMScorer.create({
      id: 'w-default',
      name: 'Default Weight',
      description: 'No weight specified',
      judge: mockLLM,
    })
      .analyze(async () => ({}))
      .score(() => 0.5)
      .build();

    expect(scorer.weight).toBe(1.0);
  });

  it('should accept custom weight in config', () => {
    const scorer = LLMScorer.create({
      id: 'w-custom',
      name: 'Custom Weight',
      description: 'Has custom weight',
      judge: mockLLM,
      weight: 0.3,
    })
      .analyze(async () => ({}))
      .score(() => 0.5)
      .build();

    expect(scorer.weight).toBe(0.3);
  });

  it('should accept zero weight', () => {
    const scorer = LLMScorer.create({
      id: 'w-zero',
      name: 'Zero Weight Scorer',
      description: 'Weight of 0',
      judge: mockLLM,
      weight: 0,
    })
      .analyze(async () => ({}))
      .score(() => 1.0)
      .build();

    expect(scorer.weight).toBe(0);
  });

  // --------------------------------------------------------
  // Evaluate — happy path
  // --------------------------------------------------------

  it('evaluates and returns ScoringResult', async () => {
    const scorer = LLMScorer.create({
      id: 'happy',
      name: 'Happy Scorer',
      description: 'Evaluates successfully',
      judge: mockLLM,
    })
      .analyze(async () => ({ passed: true }))
      .score(() => 0.95)
      .build();

    const ctx = createContext();
    const result: ScoringResult = await scorer.evaluate(ctx);

    expect(result.scorerId).toBe('happy');
    expect(result.score).toBe(0.95);
    expect(result.success).toBe(true);
    expect(typeof result.reason).toBe('string');
    // analysis is JSON string when analyze returns non-string
    expect(result.analysis).toBeDefined();
  });

  // --------------------------------------------------------
  // Evaluate — boundary scores
  // --------------------------------------------------------

  it('should handle score of 0 (minimum)', async () => {
    const scorer = LLMScorer.create({
      id: 'score-zero',
      name: 'Zero Score',
      description: 'Returns minimum score',
      judge: mockLLM,
    })
      .analyze(async () => ({ bad: true }))
      .score(() => 0)
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.score).toBe(0);
    expect(result.success).toBe(true);
  });

  it('should handle score of 1 (maximum)', async () => {
    const scorer = LLMScorer.create({
      id: 'score-one',
      name: 'Perfect Score',
      description: 'Returns maximum score',
      judge: mockLLM,
    })
      .analyze(async () => ({ perfect: true }))
      .score(() => 1)
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.score).toBe(1);
    expect(result.success).toBe(true);
  });

  // --------------------------------------------------------
  // Evaluate — default reason when reason step not provided
  // --------------------------------------------------------

  it('should generate default reason when reason step omitted', async () => {
    const scorer = LLMScorer.create({
      id: 'no-reason',
      name: 'No Reason Scorer',
      description: 'Does not provide a reason step',
      judge: mockLLM,
    })
      .analyze(async () => ({ ok: true }))
      .score(() => 0.75)
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.reason).toBe('Score: 0.75');
  });

  // --------------------------------------------------------
  // Evaluate — error handling
  // --------------------------------------------------------

  it('handles LLM errors gracefully', async () => {
    const failingLLM = createFailingLLM();
    const scorer = LLMScorer.create({
      id: 'faulty',
      name: 'Faulty Scorer',
      description: 'Will fail during LLM call',
      judge: failingLLM,
    })
      .analyze(async (_ctx, _pre, llm) => {
        await llm.chat([]);
        return {};
      })
      .score(() => 1.0)
      .build();

    const ctx = createContext();
    const result: ScoringResult = await scorer.evaluate(ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.scorerId).toBe('faulty');
    expect(result.score).toBe(0);
  });

  it('handles analyze step throwing (non-LLM error)', async () => {
    const scorer = LLMScorer.create({
      id: 'analyze-throws',
      name: 'Analyze Error',
      description: 'Analyze step throws',
      judge: mockLLM,
    })
      .analyze(async () => {
        throw new Error('Analyze logic failed');
      })
      .score(() => 1.0)
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Analyze logic failed');
    expect(result.score).toBe(0);
  });

  it('handles score step throwing', async () => {
    const scorer = LLMScorer.create({
      id: 'score-throws',
      name: 'Score Error',
      description: 'Score step throws',
      judge: mockLLM,
    })
      .analyze(async () => ({ data: true }))
      .score(() => {
        throw new Error('Score calculation failed');
      })
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Score calculation failed');
    expect(result.score).toBe(0);
  });

  it('handles preprocess step throwing', async () => {
    const scorer = LLMScorer.create({
      id: 'preprocess-throws',
      name: 'Preprocess Error',
      description: 'Preprocess step throws',
      judge: mockLLM,
    })
      .preprocess(() => {
        throw new Error('Preprocess failed');
      })
      .analyze(async () => ({ ok: true }))
      .score(() => 1.0)
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Preprocess failed');
  });

  // --------------------------------------------------------
  // Evaluate — reason step error handling
  // --------------------------------------------------------

  it('handles reason step throwing', async () => {
    const scorer = LLMScorer.create({
      id: 'reason-throws',
      name: 'Reason Error',
      description: 'Reason step throws',
      judge: mockLLM,
    })
      .analyze(async () => ({ data: true }))
      .score(() => 0.5)
      .reason(() => {
        throw new Error('Reason failed');
      })
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Reason failed');
    expect(result.score).toBe(0);
  });

  // --------------------------------------------------------
  // Evaluate — preprocess + reason
  // --------------------------------------------------------

  it('runs optional preprocess and reason steps', async () => {
    const scorer = LLMScorer.create({
      id: 'full',
      name: 'Full Pipeline Scorer',
      description: 'Uses all four pipeline steps',
      judge: mockLLM,
    })
      .preprocess((ctx) => {
        const wordCount = ctx.output.split(/\s+/).length;
        return { wordCount };
      })
      .analyze(async () => ({ passed: true }))
      .score((_ctx, results) => {
        // Deterministic: 1.0 if wordCount >= 3, proportional otherwise
        const wc = (results.preprocessed as { wordCount: number } | undefined)?.wordCount ?? 0;
        return Math.min(1.0, wc / 10);
      })
      .reason((_ctx, results, score) =>
        `Score: ${score.toFixed(2)}, ` +
        `wordCount: ${(results.preprocessed as { wordCount: number }).wordCount}`,
      )
      .build();

    const ctx = createContext({ output: 'Hello world from test runner' }); // 5 words
    const result: ScoringResult = await scorer.evaluate(ctx);

    expect(result.scorerId).toBe('full');
    expect(result.score).toBe(0.5); // 5/10 = 0.5
    expect(result.success).toBe(true);
    expect(result.reason).toContain('Score: 0.50');
    expect(result.reason).toContain('wordCount: 5');
  });

  // --------------------------------------------------------
  // Evaluate — large context
  // --------------------------------------------------------

  it('should handle large message contexts', async () => {
    const scorer = LLMScorer.create({
      id: 'large-ctx',
      name: 'Large Context Scorer',
      description: 'Handles large conversation history',
      judge: mockLLM,
    })
      .analyze(async () => ({ volume: 'large' }))
      .score(() => 0.88)
      .build();

    const ctx = createLargeContext(100); // 200 messages
    const result = await scorer.evaluate(ctx);

    expect(result.success).toBe(true);
    expect(result.score).toBe(0.88);
    expect(ctx.messages).toHaveLength(200);
  });

  // --------------------------------------------------------
  // Evaluate — multiple judges (different LLMs)
  // --------------------------------------------------------

  it('should work with different LLM judges for different scorers', async () => {
    const judgeA = createMockLLM({ content: JSON.stringify({ a: true }) });
    const judgeB = createMockLLM({ content: JSON.stringify({ b: true }) });

    const scorerA = LLMScorer.create({
      id: 'judge-A',
      name: 'Scorer with Judge A',
      description: 'Uses judge A',
      judge: judgeA,
    })
      .analyze(async (_ctx, _pre, llm) => {
        const resp = await llm.chat([]);
        return JSON.parse(resp.content);
      })
      .score(() => 0.9)
      .build();

    const scorerB = LLMScorer.create({
      id: 'judge-B',
      name: 'Scorer with Judge B',
      description: 'Uses judge B',
      judge: judgeB,
    })
      .analyze(async (_ctx, _pre, llm) => {
        const resp = await llm.chat([]);
        return JSON.parse(resp.content);
      })
      .score(() => 0.7)
      .build();

    const resultA = await scorerA.evaluate(createContext());
    const resultB = await scorerB.evaluate(createContext());

    expect(resultA.score).toBe(0.9);
    expect(resultA.analysis).toContain('"a":true');
    expect(resultB.score).toBe(0.7);
    expect(resultB.analysis).toContain('"b":true');
  });

  // --------------------------------------------------------
  // Evaluate — timeout (slow LLM)
  // --------------------------------------------------------

  it('should handle slow LLM responses', async () => {
    const slowLLM = createSlowLLM(50);
    const scorer = LLMScorer.create({
      id: 'slow',
      name: 'Slow Scorer',
      description: 'LLM takes time to respond',
      judge: slowLLM,
    })
      .analyze(async (_ctx, _pre, llm) => {
        await llm.chat([]);
        return { done: true };
      })
      .score(() => 0.5)
      .build();

    const start = Date.now();
    const result = await scorer.evaluate(createContext());
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(result.score).toBe(0.5);
    expect(elapsed).toBeGreaterThanOrEqual(40); // Should have waited at least ~50ms
  });

  // --------------------------------------------------------
  // Evaluate — underscore prefixed scorer id
  // --------------------------------------------------------

  it('should handle scorer IDs with special characters', async () => {
    const scorer = LLMScorer.create({
      id: 'my-special_scorer.v2',
      name: 'Special ID Scorer',
      description: 'Has special characters in ID',
      judge: mockLLM,
    })
      .analyze(async () => ({ valid: true }))
      .score(() => 0.42)
      .build();

    const result = await scorer.evaluate(createContext());
    expect(result.scorerId).toBe('my-special_scorer.v2');
    expect(result.success).toBe(true);
  });

  // --------------------------------------------------------
  // Evaluate — metadata passthrough
  // --------------------------------------------------------

  it('should pass context with metadata to analyze step', async () => {
    let capturedCtx: ScoringContext | undefined;

    const scorer = LLMScorer.create({
      id: 'metadata',
      name: 'Metadata Scorer',
      description: 'Captures context for inspection',
      judge: mockLLM,
    })
      .analyze(async (ctx) => {
        capturedCtx = ctx;
        return {};
      })
      .score(() => 0.5)
      .build();

    const ctx = createContext({
      metadata: { traceId: 'abc-123', experiment: 'v2' },
      groundTruth: 'expected output',
    });

    await scorer.evaluate(ctx);

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.metadata).toEqual({ traceId: 'abc-123', experiment: 'v2' });
    expect(capturedCtx!.groundTruth).toBe('expected output');
  });
});
