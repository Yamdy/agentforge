/**
 * Error Recovery System
 *
 * Tiered error recovery for LLM failures.
 * Escalates through 4 strategies before giving up:
 * 1. Escalate max_output_tokens
 * 2. Inject recovery message (nudge to continue)
 * 3. Switch to fallback model
 * 4. Trigger compaction
 *
 * Ported from ClaudeCode: src/query/errorRecovery.ts
 *
 * @see docs/design/22-ERROR-RECOVERY.md
 */

// ============================================================
// Error Analysis
// ============================================================

export type RecoveryStrategy =
  | 'escalate_output_tokens'
  | 'inject_recovery_message'
  | 'switch_fallback_model'
  | 'trigger_compaction';

export interface ErrorAnalysis {
  recoverable: boolean;
  recovery: RecoveryStrategy | null;
  errorType: string;
  message: string;
}

/**
 * Maximum attempts per recovery strategy.
 * After exceeding these limits, the strategy is exhausted and error propagates.
 */
export const RECOVERY_LIMITS = {
  outputTokenEscalation: 1,
  recoveryMessage: 3,
  fallbackSwitch: 1,
  compactionRetry: 1,
} as const;

/**
 * Escalated max_output_tokens value used when recovery escalates.
 */
export const ESCALATED_MAX_OUTPUT_TOKENS = 8192;

/**
 * Analyze an LLM error and determine if/how it can be recovered.
 *
 * Maps common LLM error patterns to recovery strategies:
 * - max_tokens / output length → escalate_output_tokens or inject_recovery_message
 * - context_length_exceeded / 413 → trigger_compaction
 * - rate_limit / 429 / overloaded → switch_fallback_model
 *
 * @param error  - The caught error
 * @param model  - Current model name (optional, for logging)
 * @param status - HTTP status code (optional)
 */
export function analyzeLLMError(
  error: Error,
  _model?: string,
  status?: number
): ErrorAnalysis {
  const message = error.message?.toLowerCase() ?? '';
  const name = error.name?.toLowerCase() ?? '';

  // ── Output token limit exceeded ──
  if (
    message.includes('max_tokens') ||
    message.includes('maximum context length') ||
    message.includes('output token') ||
    message.includes('token limit') ||
    status === 400
  ) {
    // If it's output tokens (not context window), escalate
    if (message.includes('output') || message.includes('completion')) {
      return {
        recoverable: true,
        recovery: 'escalate_output_tokens',
        errorType: 'output_token_limit',
        message: error.message,
      };
    }
    // Context window exceeded → compact
    return {
      recoverable: true,
      recovery: 'trigger_compaction',
      errorType: 'context_length_exceeded',
      message: error.message,
    };
  }

  // ── Rate limiting / overload ──
  if (
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('too many requests') ||
    message.includes('overloaded') ||
    status === 429 ||
    status === 503
  ) {
    return {
      recoverable: true,
      recovery: 'switch_fallback_model',
      errorType: 'rate_limited',
      message: error.message,
    };
  }

  // ── Timeout / connection ──
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('econnrefused') ||
    message.includes('econnreset')
  ) {
    return {
      recoverable: true,
      recovery: 'switch_fallback_model',
      errorType: 'connection_error',
      message: error.message,
    };
  }

  // ── AbortError (user cancelled) ──
  if (name.includes('abort') || message.includes('abort')) {
    return {
      recoverable: false,
      recovery: null,
      errorType: 'aborted',
      message: error.message,
    };
  }

  // ── Unrecoverable ──
  return {
    recoverable: false,
    recovery: null,
    errorType: 'unknown',
    message: error.message,
  };
}
