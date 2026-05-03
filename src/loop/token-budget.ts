/**
 * AgentForge Token Budget System
 *
 * Prevents infinite continuation by tracking diminishing returns.
 * After each continuation, the token budget delta shrinks.
 * When delta drops below threshold, the agent is forced to complete.
 *
 * Ported from ClaudeCode: src/query/tokenBudget.ts (93 lines)
 *
 * @see docs/design/21-TOKEN-BUDGET.md
 */

import type { Message } from '../core/events.js';

// ============================================================
// Budget Tracker
// ============================================================

export interface BudgetTracker {
  continuationCount: number;
  lastDeltaTokens: number;
  lastGlobalTurnTokens: number;
  startedAt: number;
}

export function createBudgetTracker(totalTokens = 0): BudgetTracker {
  return {
    continuationCount: 0,
    lastDeltaTokens: totalTokens,
    lastGlobalTurnTokens: totalTokens,
    startedAt: Date.now(),
  };
}

// ============================================================
// Budget Decision
// ============================================================

export type BudgetDecision = 'continue' | 'stop';

/**
 * Check whether the agent should continue or stop based on token budget.
 *
 * Implements diminishing returns:
 * - Each continuation gets a smaller delta budget
 * - Delta = lastDeltaTokens * 0.6
 * - Require at least tokenBudget * 0.1 tokens of progress to continue
 *
 * @param tracker   - Budget tracker (mutated by this function)
 * @param maxBudget - Total token budget for this session
 * @param usage     - Current token usage { prompt, completion }
 * @returns Decision: 'continue' means keep going, 'stop' means complete
 */
export function checkTokenBudget(
  tracker: BudgetTracker,
  maxBudget: number,
  usage: { prompt: number; completion: number }
): BudgetDecision {
  const totalTokens = usage.prompt + usage.completion;

  // Calculate delta since last check
  const deltaTokens = totalTokens - tracker.lastGlobalTurnTokens;
  tracker.lastGlobalTurnTokens = totalTokens;

  // If first check, stop if no progress (no prior continuation context)
  if (tracker.continuationCount === 0) {
    if (deltaTokens === 0) return 'stop';
    tracker.lastDeltaTokens = deltaTokens;
  } else {
    // Diminishing returns: each continuation requires at least
    // lastDeltaTokens * 0.6 to justify another round.
    // If progress is too small, stop.
    const minDelta = Math.max(tracker.lastDeltaTokens * 0.6, maxBudget * 0.1);
    if (deltaTokens < minDelta) {
      return 'stop';
    }
    tracker.lastDeltaTokens = deltaTokens;
  }

  // Check against total budget
  if (totalTokens >= maxBudget) {
    return 'stop';
  }

  tracker.continuationCount++;
  return 'continue';
}

// ============================================================
// Should Compact
// ============================================================

/**
 * Heuristic for when to trigger conversation compaction.
 *
 * Triggers when:
 * - Token usage exceeds 80% of context window
 * - OR message count exceeds 50 (many short messages)
 *
 * @param messages - Current conversation messages
 * @param tokens   - Current token usage
 * @param contextWindow - Model's context window size (default 128k)
 */
export function shouldCompact(
  messages: Message[],
  tokens: { prompt: number; completion: number },
  contextWindow = 128_000
): boolean {
  const totalTokens = tokens.prompt + tokens.completion;
  // Trigger if >80% of context window or >50 messages
  return totalTokens > contextWindow * 0.8 || messages.length > 50;
}
