/**
 * AgentForge Approval Channel
 *
 * Unified communication channel for HITL and Permission requests.
 * Both DefaultHITLController and DefaultPermissionController delegate
 * to this channel, ensuring a single approval queue for UI consumption.
 *
 * Design decisions (from design doc Section 9.3):
 * - Single onAsk() stream for UI subscription
 * - source field distinguishes 'hitl' vs 'permission' requests
 * - answer() dispatches by promptId, no cross-interference
 *
 * @module
 */

// ============================================================
// Types
// ============================================================

/**
 * Source of an approval request.
 * - 'hitl': Human-in-the-loop tool approval
 * - 'permission': Permission policy approval
 */
export type ApprovalSource = 'hitl' | 'permission';

/**
 * Options for asking an approval question.
 */
export interface ApprovalAskOptions {
  /** Unique ID for this approval request */
  promptId: string;
  /** Whether this comes from HITL or Permission */
  source: ApprovalSource;
  /** The question to present to the user */
  question: string;
  /** Additional context about the request */
  context?: Record<string, unknown>;
  /** Available response options (e.g., ['allow', 'deny', 'allow_always']) */
  options?: string[];
}

/**
 * An approval prompt emitted to UI subscribers.
 */
export interface ApprovalPrompt {
  promptId: string;
  source: ApprovalSource;
  question: string;
  context?: Record<string, unknown>;
  options?: string[];
}

// ============================================================
// Interface
// ============================================================

/**
 * Approval Channel — shared bottom layer for HITL and Permission.
 *
 * UI subscribes to onAsk() to receive ALL approval requests regardless
 * of source. The source field allows UI to render different styles
 * (HITL question vs Permission request).
 */
export interface ApprovalChannel {
  /** Request approval — calls onAnswer callback when human responds. Returns unsubscribe. */
  ask(options: ApprovalAskOptions, onAnswer: (answer: string) => void): () => void;

  /** Subscribe to approval prompts (for UI). Returns unsubscribe. */
  onAsk(listener: (prompt: ApprovalPrompt) => void): () => void;

  /** Provide an answer — called by UI when human responds */
  answer(promptId: string, response: string): void;

  /** Destroy the channel — cleanup all pending requests */
  destroy(): void;
}

// ============================================================
// Default Implementation
// ============================================================

/**
 * Default in-memory ApprovalChannel implementation.
 *
 * Uses callback pattern:
 * - ask() stores a per-request callback for the answer
 * - onAsk() exposes a listener registry for UI subscription
 * - answer() invokes the per-request callback
 *
 * This ensures HITL and Permission requests go through the same queue,
 * preventing independent popups from competing for user attention.
 */
export class DefaultApprovalChannel implements ApprovalChannel {
  private askListeners = new Set<(prompt: ApprovalPrompt) => void>();
  private answerCallbacks = new Map<string, (answer: string) => void>();

  ask(options: ApprovalAskOptions, onAnswer: (answer: string) => void): () => void {
    this.answerCallbacks.set(options.promptId, onAnswer);

    // Build prompt notification - conditional for exactOptionalPropertyTypes
    const prompt: ApprovalPrompt = {
      promptId: options.promptId,
      source: options.source,
      question: options.question,
    };
    if (options.context !== undefined) {
      prompt.context = options.context;
    }
    if (options.options !== undefined) {
      prompt.options = options.options;
    }

    // Emit prompt to UI subscribers
    for (const listener of this.askListeners) {
      try {
        listener(prompt);
      } catch (err) {
        console.warn('[ApprovalChannel] Ask listener error:', err);
      }
    }

    // Return unsubscribe
    return () => {
      this.answerCallbacks.delete(options.promptId);
    };
  }

  onAsk(listener: (prompt: ApprovalPrompt) => void): () => void {
    this.askListeners.add(listener);
    return () => {
      this.askListeners.delete(listener);
    };
  }

  answer(promptId: string, response: string): void {
    const cb = this.answerCallbacks.get(promptId);
    if (cb) {
      cb(response);
      this.answerCallbacks.delete(promptId);
    }
    // If no pending ask, silently ignore (idempotent)
  }

  destroy(): void {
    this.answerCallbacks.clear();
    this.askListeners.clear();
  }
}
