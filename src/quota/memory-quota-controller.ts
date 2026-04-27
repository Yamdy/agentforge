/**
 * Memory-based Quota Controller Implementation
 *
 * Simple in-memory quota tracking for single-process deployments.
 * Suitable for development, testing, and single-instance production.
 *
 * For distributed systems, implement QuotaController with Redis or database backend.
 *
 * @module
 */

import type { QuotaController, QuotaLimits, QuotaUsage } from './quota-controller.js';

/**
 * In-memory quota controller for token and cost management.
 *
 * Features:
 * - Session-scoped usage tracking
 * - Configurable limits for tokens and cost
 * - Thread-safe for single-process use
 * - Automatic cleanup on reset
 *
 * Limitations:
 * - Not persistent (lost on restart)
 * - Not distributed (single process only)
 *
 * @example
 * ```typescript
 * const quota = new MemoryQuotaController({
 *   maxPromptTokens: 100000,
 *   maxCompletionTokens: 50000,
 *   maxTotalCost: 10.0, // $10 USD
 * });
 *
 * // Check before LLM call
 * const allowed = await quota.check('session-123', {
 *   promptTokens: 1000,
 *   completionTokens: 0,
 * });
 *
 * if (!allowed) {
 *   throw new Error('Quota exhausted');
 * }
 *
 * // Record usage after LLM response
 * quota.consume('session-123', {
 *   promptTokens: 1200,
 *   completionTokens: 350,
 *   totalCost: 0.015,
 * });
 * ```
 */
export class MemoryQuotaController implements QuotaController {
  private readonly MAX_SESSIONS = 1000;
  private readonly limits: QuotaLimits;
  private readonly usageBySession: Map<string, QuotaUsage> = new Map();

  /**
   * Create a new memory quota controller.
   *
   * @param limits - Quota limits configuration
   */
  constructor(limits: QuotaLimits) {
    this.limits = { ...limits };
  }

  /**
   * Check if projected usage is within quota limits.
   *
   * @param sessionId - Session identifier
   * @param projected - Projected usage (typically promptTokens only)
   * @returns Promise resolving to true if allowed, false if quota exhausted
   */
  async check(sessionId: string, projected: QuotaUsage): Promise<boolean> {
    await Promise.resolve(); // Allow async interface for future async backends
    const current = this.getUsage(sessionId);

    // Check prompt tokens
    const projectedPrompt = current.promptTokens + projected.promptTokens;
    if (projectedPrompt > this.limits.maxPromptTokens) {
      return false;
    }

    // Check completion tokens
    const projectedCompletion = current.completionTokens + projected.completionTokens;
    if (projectedCompletion > this.limits.maxCompletionTokens) {
      return false;
    }

    // Check cost if configured
    if (this.limits.maxTotalCost !== undefined) {
      const currentCost = current.totalCost ?? 0;
      const projectedCost = currentCost + (projected.totalCost ?? 0);
      if (projectedCost > this.limits.maxTotalCost) {
        return false;
      }
    }

    return true;
  }

  /**
   * Record token consumption.
   *
   * Fire-and-forget - updates usage synchronously but returns void.
   *
   * @param sessionId - Session identifier
   * @param usage - Actual usage to record
   */
  consume(sessionId: string, usage: QuotaUsage): void {
    const current = this.getUsage(sessionId);

    if (!this.usageBySession.has(sessionId) && this.usageBySession.size >= this.MAX_SESSIONS) {
      const firstKey = this.usageBySession.keys().next().value;
      if (firstKey !== undefined) {
        this.usageBySession.delete(firstKey);
      }
    }

    this.usageBySession.set(sessionId, {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalCost: (current.totalCost ?? 0) + (usage.totalCost ?? 0),
    });
  }

  /**
   * Get current usage for a session.
   *
   * @param sessionId - Session identifier
   * @returns Current usage (zeros if session not found)
   */
  getUsage(sessionId: string): QuotaUsage {
    const usage = this.usageBySession.get(sessionId);
    if (usage) {
      return { ...usage };
    }
    return {
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  /**
   * Get configured limits.
   *
   * @returns Copy of the limits configuration
   */
  getLimits(): QuotaLimits {
    return { ...this.limits };
  }

  /**
   * Reset usage for a session.
   *
   * Removes the session's usage record entirely.
   *
   * @param sessionId - Session identifier
   */
  reset(sessionId: string): void {
    this.usageBySession.delete(sessionId);
  }

  /**
   * Clear all session usage records.
   *
   * Useful for testing or complete reset.
   */
  clearAll(): void {
    this.usageBySession.clear();
  }

  /**
   * Get number of active sessions being tracked.
   *
   * @returns Number of sessions with usage records
   */
  get sessionCount(): number {
    return this.usageBySession.size;
  }
}
