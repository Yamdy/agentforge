/**
 * TraceContext — Public API for span correlation queries.
 *
 * TracingPlugin internally manages span lifecycle (start/end/stack).
 * Other plugins that need span correlation query through this interface
 * instead of reading span IDs from events. This keeps event schemas clean
 * ("what happened") and span internals encapsulated ("how to trace it").
 *
 * @module observability/trace-context
 */

// ============================================================
// Interface
// ============================================================

export interface TraceContext {
  /**
   * Get the root span ID for a session.
   * The root span represents the full agent.run() invocation.
   * Returns undefined if no root span exists for this session.
   */
  getRootSpanId(sessionId: string): string | undefined;

  /**
   * Get the most recently created (active) span ID for a session.
   * This is typically the span that is currently being filled —
   * e.g., a pending llm.chat or tool.* span waiting for a response event.
   * Returns undefined if no span is active for this session.
   */
  getCurrentSpanId(sessionId: string): string | undefined;
}
