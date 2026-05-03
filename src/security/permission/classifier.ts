/**
 * Permission Classifier — ML/Human-in-the-Loop classifier interface
 *
 * Provides an extensible classification layer for tool execution permissions.
 * Inspired by ClaudeCode's TRANSCRIPT_CLASSIFIER feature (auto-mode).
 *
 * The classifier sits BEFORE the human-ask step in the permission pipeline:
 *   Tool call → evaluatePermission() → PermissionClassifier → PermissionController.ask()
 *
 * If the classifier returns 'allow' or 'deny' with high confidence,
 * the human-ask step is skipped entirely. Only 'unsure' results fall through
 * to the human-in-the-loop prompt.
 *
 * Use cases:
 * - ML-based safety classification (train on historical permission decisions)
 * - Rule-based heuristics for common patterns (e.g., "read_file is always fine in workspace")
 * - Context-aware decisions (e.g., "deny all network calls in plan mode")
 * - External service integration (e.g., call a remote classifier API)
 *
 * @module
 */

import type { PolicyDecision } from './permission-policy.js';

// ============================================================
// Types
// ============================================================

/**
 * Context passed to the classifier for decision-making.
 * Contains enough information for both rule-based and ML-based classifiers.
 */
export interface PermissionClassifierContext {
  /** Tool name being invoked */
  toolName: string;

  /** Tool arguments (may contain sensitive data — classifiers should handle safely) */
  toolArgs: Record<string, unknown>;

  /** Tool risk level from ToolDefinition */
  riskLevel: string;

  /** Session ID for cross-request context */
  sessionId: string;

  /** Current step number in the agent loop */
  step: number;

  /** The policy decision from evaluatePermission() (before classifier) */
  policyDecision: PolicyDecision;

  /** Arbitrary additional metadata the caller provides */
  metadata?: Record<string, unknown>;
}

/**
 * Classification confidence level.
 * - 'high': Classifier is very confident in its decision
 * - 'medium': Classifier has moderate confidence
 * - 'low': Classifier is guessing — should probably fall through to human
 */
export type ClassificationConfidence = 'high' | 'medium' | 'low';

/**
 * Result from a permission classifier.
 *
 * - `action: 'allow'` — grant permission without asking
 * - `action: 'deny'` — deny permission without asking
 * - `action: 'unsure'` — classifier cannot decide; fall through to human approval
 */
export interface PermissionClassification {
  /** The classifier's recommended action */
  action: PolicyDecision | 'unsure';

  /** Confidence level of this classification */
  confidence: ClassificationConfidence;

  /** Human-readable reason for the decision (for audit/logging) */
  reason: string;

  /** Optional: classifier-specific metadata for debugging */
  metadata?: Record<string, unknown>;
}

// ============================================================
// Interface
// ============================================================

/**
 * Permission Classifier Interface.
 *
 * Implementations can be rule-based, ML-driven, or call external services.
 * The framework guarantees:
 * - `classify()` is called exactly once per tool invocation
 * - Exceptions from `classify()` are caught and treated as 'unsure' (never crash the loop)
 * - The classifier is optional — if not configured, all requests fall through to human
 */
export interface PermissionClassifier {
  /** Unique name for debugging/logging */
  readonly name: string;

  /**
   * Classify a permission request.
   *
   * @param ctx - Full context for classification decision
   * @returns Classification result with action, confidence, and reason
   *
   * The returned action determines what happens next:
   * - 'allow' / 'deny': Skip human-in-the-loop, use the classifier's decision
   * - 'unsure': Fall through to human approval (existing behavior)
   *
   * Implementations SHOULD NOT throw — return 'unsure' on internal errors instead.
   * The framework wraps calls in try/catch for safety.
   */
  classify(
    ctx: PermissionClassifierContext
  ): Promise<PermissionClassification> | PermissionClassification;
}

// ============================================================
// Default Implementation (No-op — always unsure)
// ============================================================

/**
 * No-op classifier that always returns 'unsure'.
 * This is the default — preserves existing behavior where all permission
 * requests go through human-in-the-loop approval.
 */
export class NoopPermissionClassifier implements PermissionClassifier {
  readonly name = 'noop-permission-classifier';

  // eslint-disable-next-line @typescript-eslint/require-await
  async classify(ctx: PermissionClassifierContext): Promise<PermissionClassification> {
    return {
      action: 'unsure',
      confidence: 'low',
      reason: `No classifier configured — falling through to human approval for "${ctx.toolName}"`,
    };
  }
}

// ============================================================
// Safe Wrapper (Catches Classifier Errors)
// ============================================================

/**
 * Safely call a classifier, returning 'unsure' on any error.
 * This ensures a crashing classifier never kills the agent loop.
 *
 * @param classifier - The classifier to call (may be undefined)
 * @param ctx - Classification context
 * @returns Classification result (always valid, even on error)
 */
export async function safeClassify(
  classifier: PermissionClassifier | undefined,
  ctx: PermissionClassifierContext
): Promise<PermissionClassification> {
  if (!classifier) {
    return {
      action: 'unsure',
      confidence: 'low',
      reason: 'No classifier configured',
    };
  }

  try {
    return await classifier.classify(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      action: 'unsure',
      confidence: 'low',
      reason: `Classifier "${classifier.name}" threw: ${message}`,
    };
  }
}
