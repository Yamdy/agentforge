/**
 * AgentForge Error Codes
 *
 * Structured error codes for programmatic error handling.
 * External consumers can switch on ErrorCode instead of parsing error message strings.
 */

export enum ErrorCode {
  /** Agent is already running (re-entry guard) */
  AGENT_ALREADY_RUNNING = 'AGENT_ALREADY_RUNNING',

  /** Maximum step count exceeded */
  MAX_STEPS_EXCEEDED = 'MAX_STEPS_EXCEEDED',

  /** Token budget exhausted (diminishing returns) */
  TOKEN_BUDGET_EXCEEDED = 'TOKEN_BUDGET_EXCEEDED',

  /** Token/cost quota exceeded */
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  /** LLM rate limit exceeded */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  /** Tool blocked by ToolHook */
  TOOL_PERMISSION_DENIED = 'TOOL_PERMISSION_DENIED',

  /** Tool blocked by SecurityGuard */
  TOOL_SECURITY_BLOCKED = 'TOOL_SECURITY_BLOCKED',

  /** Tool execution threw an error */
  TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',

  /** Fatal LLM error (unrecoverable) */
  LLM_FATAL_ERROR = 'LLM_FATAL_ERROR',

  /** Doom loop detected (repeated identical tool calls) */
  DOOM_LOOP_DETECTED = 'DOOM_LOOP_DETECTED',

  /** Checkpoint hook blocked execution */
  CHECKPOINT_BLOCKED = 'CHECKPOINT_BLOCKED',

  /** Planner error */
  PLANNER_ERROR = 'PLANNER_ERROR',

  /** Generic internal error */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
