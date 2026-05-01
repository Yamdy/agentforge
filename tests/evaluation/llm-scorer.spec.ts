/**
 * Unit tests for src/evaluation/llm-scorer.ts
 *
 * Tests LLMScorer builder validation and evaluate pipeline.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
});
