/**
 * Completion Scorer
 *
 * Scores plan completion based on step statuses.
 *
 * @module
 */

import type { CompletionScorer, CompletionScore } from '../contracts/mpu-interfaces.js';

/** Statuses that count as completed */
const COMPLETED_STATUSES = new Set(['completed', 'done']);

/**
 * CompletionScorer implementation.
 *
 * Counts steps with status 'completed' or 'done' as finished.
 * Empty plans are considered 100% complete (vacuous truth).
 */
export class CompletionScorerImpl implements CompletionScorer {
  score(plan: { steps: Array<{ status: string }> }): CompletionScore {
    const totalSteps = plan.steps.length;

    if (totalSteps === 0) {
      return {
        percentage: 100,
        completedSteps: 0,
        totalSteps: 0,
        details: [],
      };
    }

    let completedSteps = 0;
    const statusCounts = new Map<string, number>();

    for (const step of plan.steps) {
      const count = statusCounts.get(step.status) ?? 0;
      statusCounts.set(step.status, count + 1);

      if (COMPLETED_STATUSES.has(step.status)) {
        completedSteps++;
      }
    }

    const percentage = Math.round((completedSteps / totalSteps) * 100);

    const details: string[] = [];
    for (const [status, count] of statusCounts) {
      details.push(`${status}: ${count}`);
    }

    return {
      percentage,
      completedSteps,
      totalSteps,
      details,
    };
  }
}
