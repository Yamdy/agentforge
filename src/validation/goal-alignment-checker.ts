/**
 * Goal Alignment Checker
 *
 * Checks if an action aligns with a goal using Jaccard similarity.
 * Simple keyword-based alignment: extract words → Jaccard → threshold > 0.3.
 *
 * @module
 */

import type { GoalAlignmentChecker, AlignmentResult } from '../contracts/mpu-interfaces.js';
import type { LLMAdapter } from '../core/interfaces.js';
import type { LLMScorer } from '../evaluation/llm-scorer.js';
import type { ScoringContext } from '../evaluation/types.js';
import { createGoalAlignmentScorer } from '../evaluation/scorers/goal-alignment.js';

/**
 * GoalAlignmentChecker implementation using Jaccard similarity.
 *
 * Algorithm:
 * 1. Extract keywords from action and goal (lowercase, split by non-alpha, filter ≥ 2 chars)
 * 2. Compute Jaccard similarity: |intersection| / |union|
 * 3. Threshold > 0.3 → aligned
 */
export class GoalAlignmentCheckerImpl implements GoalAlignmentChecker {
  private currentGoal: string | null = null;
  private llmScorer?: LLMScorer;

  constructor(llm?: LLMAdapter) {
    if (llm) {
      this.llmScorer = createGoalAlignmentScorer({ judge: llm });
    }
  }

  checkAlignment(action: string, goal: string): AlignmentResult {
    const actionKeywords = extractKeywords(action);
    const goalKeywords = extractKeywords(goal);

    if (actionKeywords.size === 0 || goalKeywords.size === 0) {
      return {
        aligned: false,
        confidence: 0,
        reason: 'Empty action or goal — no keywords to compare',
      };
    }

    const intersection = new Set<string>();
    for (const word of actionKeywords) {
      if (goalKeywords.has(word)) {
        intersection.add(word);
      }
    }

    const union = new Set<string>([...actionKeywords, ...goalKeywords]);
    const jaccard = intersection.size / union.size;
    const aligned = jaccard > 0.3;

    return {
      aligned,
      confidence: jaccard,
      reason: aligned
        ? `Action shares keywords with goal (Jaccard: ${jaccard.toFixed(2)})`
        : `Action does not share enough keywords with goal (Jaccard: ${jaccard.toFixed(2)}, threshold: 0.3)`,
    };
  }

  setGoal(goal: string): void {
    this.currentGoal = goal;
  }

  getGoal(): string | null {
    return this.currentGoal;
  }

  async checkAlignmentAsync(action: string, goal: string): Promise<AlignmentResult> {
    // Step 1: Run Jaccard as fast pre-filter
    const jaccardResult = this.checkAlignment(action, goal);

    // Step 2: If clearly aligned (Jaccard > 0.5), return immediately
    if (jaccardResult.confidence > 0.5) {
      return jaccardResult;
    }

    // Step 3: If clearly misaligned (Jaccard < 0.2), return immediately
    if (jaccardResult.confidence < 0.2) {
      return jaccardResult;
    }

    // Step 4: Borderline case (0.2-0.5) — use LLM scorer for semantic evaluation
    if (!this.llmScorer) {
      return jaccardResult;
    }

    const ctx: ScoringContext = {
      input: action,
      output: '',
      messages: [],
      agentName: 'goal-alignment-checker',
      sessionId: 'goal-check',
      metadata: { goal },
    };

    const result = await this.llmScorer.evaluate(ctx);

    return {
      aligned: result.score >= 0.5,
      confidence: result.score,
      reason: result.reason,
    };
  }
}

/**
 * Extract keywords from text.
 * - Lowercase
 * - Split on non-alphanumeric characters
 * - Filter empty tokens
 */
function extractKeywords(text: string): Set<string> {
  if (!text || !text.trim()) {
    return new Set<string>();
  }

  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 1);

  return new Set(tokens);
}
