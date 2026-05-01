/**
 * Validation module exports.
 *
 * Provides result validation, goal alignment checking, completion scoring,
 * and quality gate for LLM output validation.
 *
 * @module
 */

export { ResultValidatorImpl } from './result-validator.js';
export { GoalAlignmentCheckerImpl } from './goal-alignment-checker.js';
export { CompletionScorerImpl } from './completion-scorer.js';
export {
  QualityGate,
  DEFAULT_QUALITY_GATE_CONFIG,
  type QualityGateConfig,
  type QualityGateCheck,
  type QualityGateReason,
  type PatternRule,
} from './quality-gate.js';
