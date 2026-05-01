/**
 * Evaluation Framework — Module barrel export
 *
 * @module evaluation
 */

export { LLMScorer, LLMScorerBuilder } from './llm-scorer.js';
export { runScorerPipeline } from './pipeline.js';
export { evaluateAgent } from './evaluator.js';
export { createAnswerAccuracyScorer } from './scorers/answer-accuracy.js';
export { createTaskCompletionScorer } from './scorers/task-completion.js';
export { createSafetyAlignmentScorer } from './scorers/safety-alignment.js';

export type {
  ScoringContext,
  ScoringResult,
  EvaluationResult,
  ScorerStepResults,
  PreprocessFn,
  AnalyzeFn,
  ScoreFn,
  ReasonFn,
  LLMScorerConfig,
  EvaluatorConfig,
  SamplingConfig,
} from './types.js';

export type { PipelineStrategy, PipelineOptions } from './pipeline.js';
export type { TestCase, EvaluateAgentOptions, EvaluateAgentResult } from './evaluator.js';
