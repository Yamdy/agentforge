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

import { Observable, Subject } from 'rxjs';

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
  /** Request approval — returns Observable that emits when human answers */
  ask(options: ApprovalAskOptions): Observable<string>;

  /** Observable of approval prompts (for UI subscription) */
  onAsk(): Observable<ApprovalPrompt>;

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
 * Uses Subject pattern identical to DefaultHITLController:
 * - ask() creates a per-request Subject for the answer
 * - onAsk() exposes a shared Subject for UI subscription
 * - answer() resolves the per-request Subject
 *
 * This ensures HITL and Permission requests go through the same queue,
 * preventing independent popups from competing for user attention.
 */
export class DefaultApprovalChannel implements ApprovalChannel {
  private askSubject = new Subject<ApprovalPrompt>();
  private answerMap = new Map<string, Subject<string>>();

  ask(options: ApprovalAskOptions): Observable<string> {
    return new Observable(subscriber => {
      const answerSubject = new Subject<string>();
      this.answerMap.set(options.promptId, answerSubject);

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
      this.askSubject.next(prompt);

      // Subscribe to answer and forward
      const subscription = answerSubject.subscribe({
        next: answer => {
          subscriber.next(answer);
          subscriber.complete();
        },
      });

      // Cleanup on unsubscribe
      return () => {
        subscription.unsubscribe();
        this.answerMap.delete(options.promptId);
      };
    });
  }

  onAsk(): Observable<ApprovalPrompt> {
    return this.askSubject.asObservable();
  }

  answer(promptId: string, response: string): void {
    const subject = this.answerMap.get(promptId);
    if (subject) {
      subject.next(response);
      subject.complete();
      this.answerMap.delete(promptId);
    }
    // If no pending ask, silently ignore (idempotent)
  }

  destroy(): void {
    for (const answerSubject of Array.from(this.answerMap.values())) {
      answerSubject.complete();
    }
    this.answerMap.clear();
    this.askSubject.complete();
  }
}
