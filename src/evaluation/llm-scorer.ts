/**
 * LLM Scorer — Builder-based LLM-as-Judge evaluation
 *
 * Implements a fluent 4-step pipeline for evaluating agent outputs
 * using an LLM as the judge. The Builder pattern enforces required
 * steps at build time rather than relying on compile-time checks.
 *
 * Pipeline:
 *   1. preprocess (optional) — prepare context before analysis
 *   2. analyze (required)    — LLM-as-Judge structured analysis
 *   3. score (required)      — deterministic score calculation
 *   4. reason (optional)     — human-readable explanation
 *
 * @example
 * ```ts
 * const scorer = LLMScorer.create({
 *   id: 'answer-accuracy',
 *   name: 'Answer Accuracy',
 *   description: 'Measures how well the output matches expectations',
 *   judge: myLLMAdapter,
 * })
 *   .preprocess((ctx) => ({ input: ctx.input, output: ctx.output }))
 *   .analyze(async (ctx, pre, llm) => {
 *     const resp = await llm.chat([...]);
 *     return JSON.parse(resp.content);
 *   })
 *   .score((ctx, results) => results.analysis?.score ?? 0)
 *   .build();
 *
 * const result = await scorer.evaluate(ctx);
 * ```
 *
 * @module evaluation/llm-scorer
 */

import type {
  ScoringContext,
  ScoringResult,
  ScorerStepResults,
  PreprocessFn,
  AnalyzeFn,
  ScoreFn,
  ReasonFn,
  LLMScorerConfig,
} from './types.js';

// ============================================================
// LLMScorer
// ============================================================

/**
 * LLMScorer — the built scorer ready for evaluation.
 *
 * Created via {@link LLMScorer.create}() fluent builder.
 * Runs a 4-step pipeline against a {@link ScoringContext}.
 */
export class LLMScorer {
  private readonly config: LLMScorerConfig;
  private readonly preprocessFn: PreprocessFn | undefined;
  private readonly analyzeFn: AnalyzeFn;
  private readonly scoreFn: ScoreFn;
  private readonly reasonFn: ReasonFn | undefined;

  constructor(
    config: LLMScorerConfig,
    analyzeFn: AnalyzeFn,
    scoreFn: ScoreFn,
    preprocessFn: PreprocessFn | undefined,
    reasonFn: ReasonFn | undefined
  ) {
    this.config = config;
    this.analyzeFn = analyzeFn;
    this.scoreFn = scoreFn;
    this.preprocessFn = preprocessFn;
    this.reasonFn = reasonFn;
  }

  /**
   * Create a new {@link LLMScorerBuilder} for fluent configuration.
   *
   * @example
   * ```ts
   * const scorer = LLMScorer.create({
   *   id: 'task-completion',
   *   name: 'Task Completion',
   *   description: 'Evaluates whether the agent completed the task',
   *   judge: myLLMAdapter,
   *   weight: 0.5,
   * })
   *   .analyze(myAnalyzeFn)
   *   .score(myScoreFn)
   *   .reason(myReasonFn)
   *   .build();
   * ```
   */
  static create(config: LLMScorerConfig): LLMScorerBuilder {
    return new LLMScorerBuilder(config);
  }

  /**
   * Evaluate agent output through the full 4-step pipeline.
   *
   * Steps executed in order:
   * 1. **preprocess** — optional context preparation (e.g., extract relevant fields)
   * 2. **analyze** — LLM-as-Judge call for structured analysis
   * 3. **score** — deterministic function computing a normalized 0–1 score
   * 4. **reason** — optional human-readable explanation generator
   *
   * The entire pipeline is wrapped in try/catch. On any failure,
   * returns a {@link ScoringResult} with `success: false` and `error` set.
   *
   * @param ctx - Scoring context with input, output, and conversation history
   * @returns ScoringResult with score, reason, and analysis details
   */
  async evaluate(ctx: ScoringContext): Promise<ScoringResult> {
    try {
      const results: ScorerStepResults = {};

      // Step 1: Preprocess (optional)
      if (this.preprocessFn) {
        results.preprocessed = await this.preprocessFn(ctx);
      }

      // Step 2: Analyze — LLM-as-Judge (required, validated at build time)
      results.analysis = await this.analyzeFn(ctx, results.preprocessed, this.config.judge);

      // Step 3: Score — deterministic (required, validated at build time)
      results.finalScore = await this.scoreFn(ctx, results);

      // Step 4: Reason — human-readable explanation (optional)
      if (this.reasonFn) {
        results.finalReason = await this.reasonFn(ctx, results, results.finalScore);
      } else {
        results.finalReason = `Score: ${results.finalScore}`;
      }

      return {
        scorerId: this.config.id,
        scorerName: this.config.name,
        score: results.finalScore,
        reason: results.finalReason,
        analysis:
          typeof results.analysis === 'string'
            ? results.analysis
            : JSON.stringify(results.analysis),
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return {
        scorerId: this.config.id,
        scorerName: this.config.name,
        score: 0,
        reason: `Evaluation failed: ${message}`,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Weight for composite scoring.
   *
   * Defaults to 1.0 when not specified in config.
   */
  get weight(): number {
    return this.config.weight ?? 1.0;
  }
}

// ============================================================
// LLMScorerBuilder
// ============================================================

/**
 * Fluent builder for {@link LLMScorer}.
 *
 * Collects step functions via chained method calls and validates
 * required steps (analyze, score) at `.build()` time. This provides
 * runtime safety since TypeScript cannot enforce step ordering at
 * compile time with a flexible fluent API.
 *
 * @example
 * ```ts
 * const scorer = LLMScorer.create(config)
 *   .preprocess(fn)   // optional
 *   .analyze(fn)      // required
 *   .score(fn)        // required
 *   .reason(fn)       // optional
 *   .build();         // throws if analyze or score missing
 * ```
 */
export class LLMScorerBuilder {
  private readonly config: LLMScorerConfig;
  private _preprocessFn?: PreprocessFn;
  private _analyzeFn?: AnalyzeFn;
  private _scoreFn?: ScoreFn;
  private _reasonFn?: ReasonFn;

  constructor(config: LLMScorerConfig) {
    this.config = config;
  }

  /**
   * Register the preprocess function (optional).
   *
   * Called first in the pipeline. Use this to extract,
   * transform, or enrich context data before LLM analysis.
   *
   * @param fn - Function receiving ScoringContext, returning preprocessed data
   */
  preprocess(fn: PreprocessFn): this {
    this._preprocessFn = fn;
    return this;
  }

  /**
   * Register the analyze function (required).
   *
   * The LLM-as-Judge step. Receives the scoring context,
   * preprocessed data, and the judge {@link LLMAdapter}.
   * Must return structured analysis data (e.g., parsed JSON).
   *
   * @param fn - Analyze function with LLM adapter access
   */
  analyze(fn: AnalyzeFn): this {
    this._analyzeFn = fn;
    return this;
  }

  /**
   * Register the score function (required).
   *
   * Deterministic function computing a normalized 0–1 score from
   * the accumulated {@link ScorerStepResults}. No LLM calls here —
   * pure computation based on analysis results.
   *
   * @param fn - Score function receiving context and step results
   */
  score(fn: ScoreFn): this {
    this._scoreFn = fn;
    return this;
  }

  /**
   * Register the reason function (optional).
   *
   * Generates a human-readable explanation for the score.
   * Receives the scoring context, all step results, and the final score.
   * If not provided, a default reason ("Score: {value}") is used.
   *
   * @param fn - Reason generation function
   */
  reason(fn: ReasonFn): this {
    this._reasonFn = fn;
    return this;
  }

  /**
   * Build and return the configured {@link LLMScorer}.
   *
   * Validates that required steps (analyze, score) have been registered.
   *
   * @returns A ready-to-use LLMScorer instance
   * @throws {Error} If analyze or score step is missing
   */
  build(): LLMScorer {
    if (!this._analyzeFn) {
      throw new Error(
        `LLMScorer "${this.config.id}": analyze step is required but was not set. ` +
          'Call .analyze(fn) before .build().'
      );
    }

    if (!this._scoreFn) {
      throw new Error(
        `LLMScorer "${this.config.id}": score step is required but was not set. ` +
          'Call .score(fn) before .build().'
      );
    }

    return new LLMScorer(
      this.config,
      this._analyzeFn,
      this._scoreFn,
      this._preprocessFn,
      this._reasonFn
    );
  }
}
