/**
 * Evaluation Framework Core Types
 *
 * Modeled after Mastra's ScorerRun + ScoringResult, adapted for
 * AgentForge's Message-based context and Zod type safety.
 *
 * @module evaluation/types
 */

import type { Message } from '../core/events.js';
import type { LLMAdapter } from '../core/interfaces.js';

// ============================================================
// Scoring Context
// ============================================================

/**
 * Input data passed to each scorer for evaluation.
 */
export interface ScoringContext {
  /** User's original input/message */
  input: string;
  /** Agent's final output */
  output: string;
  /** Full conversation history (messages up to this point) */
  messages: Message[];
  /** Optional ground truth for benchmark evaluation */
  groundTruth?: string;
  /** Optional expected trajectory for trajectory-based scoring */
  expectedTrajectory?: string[];
  /** Agent metadata */
  agentName: string;
  /** Session identifier */
  sessionId: string;
  /** Arbitrary request-level metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Scoring Result
// ============================================================

/**
 * Single scorer result after evaluation.
 */
export interface ScoringResult {
  /** Scorer identifier */
  scorerId: string;
  /** Human-readable scorer name */
  scorerName: string;
  /** Normalized score 0-1 (0 = worst, 1 = best) */
  score: number;
  /** Human-readable explanation for the score */
  reason: string;
  /** Structured sub-dimension scores (optional) */
  dimensions?: Record<string, number>;
  /** LLM-generated analysis details */
  analysis?: string;
  /** Whether evaluation succeeded (false if LLM call failed) */
  success: boolean;
  /** Error message if evaluation failed */
  error?: string;
}

/**
 * Aggregated evaluation result from multiple scorers.
 */
export interface EvaluationResult {
  /** Session/run identifier */
  runId: string;
  /** Individual scorer results */
  scores: ScoringResult[];
  /** Composite score (weighted average of all scorers) */
  compositeScore: number;
  /** Summary of all scorer reasons */
  summary: string;
  /** Timestamp of evaluation */
  timestamp: number;
  /** Duration in ms */
  duration: number;
}

// ============================================================
// Scorer Step Functions
// ============================================================

/**
 * Accumulated step results — passed through the pipeline.
 * Each step reads from and writes to this object.
 */
export interface ScorerStepResults {
  /** Result from the preprocess step */
  preprocessed?: unknown;
  /** Result from the analyze step (LLM structured output) */
  analysis?: unknown;
  /** Final score (set by generateScore) */
  finalScore?: number;
  /** Final reason (set by generateReason) */
  finalReason?: string;
}

/** Function signature for the preprocess step */
export type PreprocessFn = (ctx: ScoringContext) => unknown;

/** Function signature for the analyze step (LLM-based) */
export type AnalyzeFn = (
  ctx: ScoringContext,
  preprocessed: unknown,
  llm: LLMAdapter
) => Promise<unknown>;

/** Function signature for the score calculation step (deterministic) */
export type ScoreFn = (ctx: ScoringContext, results: ScorerStepResults) => number | Promise<number>;

/** Function signature for the reason generation step */
export type ReasonFn = (
  ctx: ScoringContext,
  results: ScorerStepResults,
  score: number
) => string | Promise<string>;

// ============================================================
// Scorer Configuration
// ============================================================

/**
 * Configuration for building an LLMScorer.
 */
export interface LLMScorerConfig {
  /** Unique identifier (used in results) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this scorer measures */
  description: string;
  /** LLM adapter to use as judge */
  judge: LLMAdapter;
  /** Weight in composite scoring (default: 1.0) */
  weight?: number;
}

// ============================================================
// Evaluator Configuration
// ============================================================

/**
 * Configuration for batch evaluation.
 */
/**
 * Configuration for batch evaluation.
 * Scorers are LLMScorer instances created via LLMScorer.create().build().
 */
export interface EvaluatorConfig {
  /** Scorers to run */
  scorers: Array<{
    evaluate(ctx: ScoringContext): Promise<ScoringResult>;
    readonly weight: number;
  }>;
  /** Max concurrency for parallel scoring (default: 3) */
  concurrency?: number;
  /** Whether to fail fast on first error (default: false) */
  failFast?: boolean;
}

// ============================================================
// Sampling Configuration
// ============================================================

/**
 * Controls how often scoring is triggered when integrated into loop.
 */
export interface SamplingConfig {
  /** Sampling strategy */
  strategy: 'none' | 'ratio' | 'every_n';
  /** Ratio 0-1 (for 'ratio' strategy) */
  rate?: number;
  /** Every N invocations (for 'every_n' strategy) */
  n?: number;
}
