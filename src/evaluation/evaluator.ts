/**
 * Batch Evaluator — Runs an agent against multiple test cases with scoring.
 *
 * Orchestrates agent.run() calls, builds ScoringContext per test case,
 * delegates to runScorerPipeline(), and computes aggregate metrics.
 *
 * @module evaluation/evaluator
 */

import type { Message } from '../core/events.js';
import type { LLMScorer } from './llm-scorer.js';
import { runScorerPipeline } from './pipeline.js';
import type { ScoringContext, EvaluationResult } from './types.js';

// ============================================================
// Types
// ============================================================

/** A single test case for benchmark evaluation. */
export interface TestCase {
  /** User input to send to the agent */
  input: string;
  /** Known-correct answer for comparison-based scoring */
  groundTruth?: string;
  /** Expected tool-call trajectory for trajectory-based scoring */
  expectedTrajectory?: string[];
  /** Conversation history to prepend before this input */
  history?: Message[];
  /** Arbitrary metadata passed through to ScoringContext */
  metadata?: Record<string, unknown>;
}

/** Options controlling batch evaluation. */
export interface EvaluateAgentOptions {
  /** Scorers to run against each test case */
  scorers: LLMScorer[];
  /** Test cases to evaluate */
  testCases: TestCase[];
  /** Max concurrent agent runs (default: 2) */
  concurrency?: number;
  /** Identifier for this evaluation run (default: 'eval-{timestamp}') */
  runId?: string;
  /** Hard cap on total LLM calls; stops early if reached (default: unlimited) */
  maxLLMCalls?: number;
}

/** Aggregated result from a batch evaluation run. */
export interface EvaluateAgentResult {
  /** Run identifier */
  runId: string;
  /** Per-test-case evaluation results */
  results: EvaluationResult[];
  /** Average of all composite scores (0-1) */
  aggregateScore: number;
  /** Number of test cases evaluated */
  totalCases: number;
  /** Wall-clock duration in milliseconds */
  duration: number;
}

// ============================================================
// Public API
// ============================================================

/**
 * Evaluate an agent against a set of test cases using the provided scorers.
 *
 * Processes test cases in batches respecting the concurrency limit.
 * Computes an aggregate score (average of per-case composite scores).
 *
 * @param agent - Object with a `run(input: string) => Promise<string>` method
 * @param options - Scorers, test cases, and execution controls
 * @returns Aggregated evaluation results with scoring details
 */
export async function evaluateAgent(
  agent: { run: (input: string) => Promise<string> },
  options: EvaluateAgentOptions
): Promise<EvaluateAgentResult> {
  const {
    scorers,
    testCases,
    concurrency = 2,
    runId = `eval-${Date.now()}`,
    maxLLMCalls,
  } = options;

  const startTime = Date.now();
  const results: EvaluationResult[] = [];
  let totalLLMCalls = 0;

  // Process test cases in concurrency-limited batches
  for (let i = 0; i < testCases.length; i += concurrency) {
    // Cost guard — break early if LLM call cap reached
    if (maxLLMCalls !== undefined && totalLLMCalls >= maxLLMCalls) {
      console.warn(
        `evaluateAgent: maxLLMCalls (${maxLLMCalls}) reached ` +
          `at test case ${i + 1}/${testCases.length}. Stopping.`
      );
      break;
    }

    const batch = testCases.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (testCase, batchIdx) => {
        const caseIdx = i + batchIdx;

        // Run agent to get output
        const output = await agent.run(testCase.input);

        // Build scoring context (exactOptionalPropertyTypes: only include optionals when present)
        const ctx: ScoringContext = {
          input: testCase.input,
          output,
          messages: testCase.history ?? [],
          ...(testCase.groundTruth !== undefined ? { groundTruth: testCase.groundTruth } : {}),
          ...(testCase.expectedTrajectory !== undefined
            ? { expectedTrajectory: testCase.expectedTrajectory }
            : {}),
          ...(testCase.metadata !== undefined ? { metadata: testCase.metadata } : {}),
          agentName: 'evaluation-target',
          sessionId: `${runId}-case-${caseIdx}`,
        };

        return runScorerPipeline(scorers, ctx);
      })
    );

    results.push(...batchResults);

    // Each scorer makes one LLM call per evaluation
    totalLLMCalls += scorers.length * batch.length;
  }

  // Compute aggregate: average of all compositeScores
  const totalCases = results.length;
  const aggregateScore =
    totalCases > 0 ? results.reduce((sum, r) => sum + r.compositeScore, 0) / totalCases : 0;

  return {
    runId,
    results,
    aggregateScore,
    totalCases,
    duration: Date.now() - startTime,
  };
}
