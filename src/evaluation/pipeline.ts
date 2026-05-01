/**
 * Scorer Pipeline — Orchestrates multiple LLMScorers against a single context.
 *
 * Supports parallel (batched) and sequential execution strategies,
 * weighted composite scoring, and summary generation.
 *
 * @module evaluation/pipeline
 */

import type { LLMScorer } from './llm-scorer.js';
import type { ScoringContext, EvaluationResult, ScoringResult } from './types.js';

// ============================================================
// Types
// ============================================================

/** Execution strategy for the scorer pipeline. */
export type PipelineStrategy = 'parallel' | 'sequential';

/** Options controlling pipeline execution. */
export interface PipelineOptions {
  /** Execution strategy (default: 'parallel') */
  strategy?: PipelineStrategy;
  /** Max concurrent scorers in parallel mode (default: 3) */
  maxConcurrency?: number;
}

// ============================================================
// Public API
// ============================================================

/**
 * Run a set of scorers against a single {@link ScoringContext}.
 *
 * Returns an aggregated {@link EvaluationResult} with individual scores,
 * weighted composite score, and human-readable summary.
 *
 * @param scorers - Array of built LLMScorer instances
 * @param ctx - Scoring context (input, output, history, etc.)
 * @param options - Execution strategy and concurrency limits
 */
export async function runScorerPipeline(
  scorers: LLMScorer[],
  ctx: ScoringContext,
  options: PipelineOptions = {}
): Promise<EvaluationResult> {
  const { strategy = 'parallel', maxConcurrency = 3 } = options;

  const startTime = Date.now();

  // Guard: empty scorers
  if (scorers.length === 0) {
    return {
      runId: ctx.sessionId,
      scores: [],
      compositeScore: 0,
      summary: 'No scorers configured.',
      timestamp: Date.now(),
      duration: 0,
    };
  }

  // Execute scorers
  const results: ScoringResult[] =
    strategy === 'sequential'
      ? await runSequential(scorers, ctx)
      : await runParallel(scorers, ctx, maxConcurrency);

  // Compute weighted composite score
  let totalWeight = 0;
  let weightedSum = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.success) {
      const weight = scorers[i]!.weight;
      totalWeight += weight;
      weightedSum += result.score * weight;
    }
  }

  const compositeScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Generate summary from successful scorers
  const summaryLines = results
    .filter(r => r.success)
    .map(r => {
      const percent = Math.round(r.score * 100);
      return `  ${r.scorerName}: ${percent}% — ${r.reason}`;
    });

  return {
    runId: ctx.sessionId,
    scores: results,
    compositeScore,
    summary: summaryLines.length > 0 ? summaryLines.join('\n') : 'All scorers failed.',
    timestamp: Date.now(),
    duration: Date.now() - startTime,
  };
}

// ============================================================
// Internal execution strategies
// ============================================================

/** Run scorers one at a time in order. */
async function runSequential(scorers: LLMScorer[], ctx: ScoringContext): Promise<ScoringResult[]> {
  const results: ScoringResult[] = [];
  for (const scorer of scorers) {
    results.push(await scorer.evaluate(ctx));
  }
  return results;
}

/** Run scorers in batches respecting maxConcurrency. */
async function runParallel(
  scorers: LLMScorer[],
  ctx: ScoringContext,
  maxConcurrency: number
): Promise<ScoringResult[]> {
  const results: ScoringResult[] = [];
  for (let i = 0; i < scorers.length; i += maxConcurrency) {
    const batch = scorers.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(batch.map(s => s.evaluate(ctx)));
    results.push(...batchResults);
  }
  return results;
}
