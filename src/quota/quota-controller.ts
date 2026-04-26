/**
 * AgentForge Quota Controller Interface
 *
 * Production-grade quota management for LLM token and cost control.
 * Checks quota before LLM calls to prevent over-consumption.
 *
 * Design principles:
 * - Pre-check before LLM invocation (avoid wasted API calls)
 * - Fire-and-forget consumption (don't block response flow)
 * - Session-scoped tracking (multi-tenant isolation)
 * - Graceful degradation (missing quota = allowed)
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/06-FLOW-CONSTRAINTS.md
 */

/**
 * Quota usage metrics for a session
 */
export interface QuotaUsage {
  /** Tokens consumed in prompts (input to LLM) */
  promptTokens: number;
  /** Tokens consumed in completions (output from LLM) */
  completionTokens: number;
  /** Optional total cost in USD */
  totalCost?: number;
}

/**
 * Quota limits configuration
 */
export interface QuotaLimits {
  /** Maximum prompt tokens allowed */
  maxPromptTokens: number;
  /** Maximum completion tokens allowed */
  maxCompletionTokens: number;
  /** Optional maximum total cost in USD */
  maxTotalCost?: number;
}

/**
 * Quota controller interface for token and cost management.
 *
 * Implementations can use in-memory storage, Redis, database, etc.
 * The MemoryQuotaController provides a simple in-memory implementation.
 *
 * Usage in AgentContext:
 * ```typescript
 * const quota = new MemoryQuotaController({
 *   maxPromptTokens: 100000,
 *   maxCompletionTokens: 50000,
 * });
 *
 * const ctx: AgentContext = {
 *   ...otherServices,
 *   quota,
 * };
 * ```
 */
export interface QuotaController {
  /**
   * Check if projected usage is within quota limits.
   *
   * Called before LLM invocation to prevent wasted API calls.
   * Returns false if the projected usage would exceed limits.
   *
   * @param sessionId - Unique session identifier
   * @param projected - Projected token usage (typically promptTokens only)
   * @returns true if allowed, false if quota exhausted
   */
  check(sessionId: string, projected: QuotaUsage): Promise<boolean>;

  /**
   * Record actual token consumption.
   *
   * Called after LLM response with actual usage from the API.
   * Fire-and-forget - does not block the response flow.
   *
   * @param sessionId - Unique session identifier
   * @param usage - Actual token usage from LLM response
   */
  consume(sessionId: string, usage: QuotaUsage): void;

  /**
   * Get current usage for a session.
   *
   * @param sessionId - Unique session identifier
   * @returns Current accumulated usage
   */
  getUsage(sessionId: string): QuotaUsage;

  /**
   * Get configured limits.
   *
   * @returns The quota limits configuration
   */
  getLimits(): QuotaLimits;

  /**
   * Reset usage for a session.
   *
   * Called when starting a new conversation or after quota period reset.
   *
   * @param sessionId - Unique session identifier
   */
  reset(sessionId: string): void;
}
