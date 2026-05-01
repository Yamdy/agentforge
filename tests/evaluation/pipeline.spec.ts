/**
 * Unit tests for src/evaluation/pipeline.ts — runScorerPipeline
 *
 * Tests orchestration logic: parallel/sequential execution,
 * weighted composite scoring, and maxConcurrency enforcement.
 */

import { describe, it, expect } from 'vitest';
import { runScorerPipeline } from '../../src/evaluation/pipeline.js';
import type { ScoringContext } from '../../src/evaluation/types.js';

// ============================================================
// Helpers
// ============================================================

const ctx: ScoringContext = {
  input: 'test input',
  output: 'test output',
  messages: [],
  agentName: 'test-agent',
  sessionId: 'test-session',
};

const makeScorer = (id: string, score: number, weight = 1.0): any => ({
  config: { id, name: id, description: '', judge: {} as any, weight },
  weight,
  evaluate: async () => ({
    scorerId: id,
    scorerName: id,
    score,
    reason: `test ${id}`,
    success: true,
  }),
});

/** Creates a scorer that records concurrency peaks via a shared array. */
const makeTrackedScorer = (
  id: string,
  score: number,
  concurrentCounter: { value: number },
  peaks: number[],
  delayMs = 10,
): any => ({
  config: { id, name: id, description: '', judge: {} as any, weight: 1.0 },
  weight: 1.0,
  evaluate: async () => {
    concurrentCounter.value++;
    peaks.push(concurrentCounter.value);
    await new Promise((r) => setTimeout(r, delayMs));
    concurrentCounter.value--;
    return { scorerId: id, scorerName: id, score, reason: `test ${id}`, success: true };
  },
});

// ============================================================
// Tests
// ============================================================

describe('runScorerPipeline', () => {
  it('runs scorers in parallel and aggregates', async () => {
    const s1 = makeScorer('s1', 0.6, 1.0);
    const s2 = makeScorer('s2', 0.9, 2.0);

    const result = await runScorerPipeline([s1, s2], ctx);

    expect(result.scores).toHaveLength(2);
    expect(result.compositeScore).toBeCloseTo(
      (1.0 * 0.6 + 2.0 * 0.9) / (1.0 + 2.0),
    );
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain('s1');
    expect(result.summary).toContain('s2');
  });

  it('respects maxConcurrency', async () => {
    const counter = { value: 0 };
    const peaks: number[] = [];
    const scorers = [
      makeTrackedScorer('a', 0.5, counter, peaks, 20),
      makeTrackedScorer('b', 0.5, counter, peaks, 20),
      makeTrackedScorer('c', 0.5, counter, peaks, 20),
    ];

    await runScorerPipeline(scorers, ctx, { maxConcurrency: 2 });

    // With maxConcurrency=2, the highest concurrency peak must be ≤ 2.
    // With 3 scorers and maxConcurrency=2, the pipeline runs in two batches
    // (2 in first batch, 1 in second), so peak should be exactly 2.
    const maxPeak = Math.max(...peaks);
    expect(maxPeak).toBe(2);
    expect(scorers).toHaveLength(3);
  });

  it('computes weighted composite score correctly', async () => {
    const s1 = makeScorer('accuracy', 0.8, 1.0);
    const s2 = makeScorer('completeness', 0.4, 2.0);

    const result = await runScorerPipeline([s1, s2], ctx);

    // (1*0.8 + 2*0.4) / (1+2) = 1.6/3 ≈ 0.533
    expect(result.compositeScore).toBeCloseTo(1.6 / 3, 3);
    expect(result.scores[0]!.score).toBe(0.8);
    expect(result.scores[1]!.score).toBe(0.4);
  });

  it('runs sequentially when strategy=sequential', async () => {
    const order: string[] = [];
    const makeOrderedScorer = (id: string, score: number): any => ({
      config: { id, name: id, description: '', judge: {} as any, weight: 1.0 },
      weight: 1.0,
      evaluate: async () => {
        order.push(id);
        return { scorerId: id, scorerName: id, score, reason: `test ${id}`, success: true };
      },
    });

    const s1 = makeOrderedScorer('first', 0.7);
    const s2 = makeOrderedScorer('second', 0.3);

    const result = await runScorerPipeline([s1, s2], ctx, { strategy: 'sequential' });

    expect(order).toEqual(['first', 'second']);
    expect(result.scores).toHaveLength(2);
    expect(result.scores[0]!.scorerId).toBe('first');
    expect(result.scores[1]!.scorerId).toBe('second');
    expect(result.compositeScore).toBeCloseTo(0.5);
  });
});
