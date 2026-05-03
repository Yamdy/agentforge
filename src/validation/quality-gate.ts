/**
 * Quality Gate — Lightweight LLM output validation
 *
 * Checks LLM responses for obvious quality issues BEFORE they pollute
 * the conversation context. Runs inside the agent loop, after every
 * LLM response, with NO LLM dependency (pure rule-based).
 *
 * Design principles:
 * - Zero LLM dependency (no LLM-as-judge — that's Mastra's Evaluator)
 * - Synchronous (no async rules)
 * - Configurable blocking (block on certain issues, warn on others)
 * - Self-contained state (ring buffer for loop detection)
 *
 * @see docs/design/harness.md — V-评估接口 section
 */

import type { AgentState } from '../core/state.js';

// ============================================================
// Types
// ============================================================

/** Quality gate issue codes */
export type QualityGateReason =
  | 'empty_response'
  | 'hallucination_pattern'
  | 'loop_detected'
  | 'refusal_pattern';

/** Single check result */
export interface QualityGateCheck {
  /** Whether the output passes (can proceed) */
  passed: boolean;
  /** Human-readable feedback for the LLM when blocked */
  feedback: string | undefined;
  /** Detected issue codes (for observability) */
  reasons: QualityGateReason[];
}

/** Configuration for a single pattern rule */
export interface PatternRule {
  /** Regex to match against LLM output */
  pattern: RegExp;
  /** Reason code to attach when matched */
  reason: QualityGateReason;
  /** How many consecutive matches before blocking (default: 1) */
  threshold: number;
}

/** Full quality gate configuration */
export interface QualityGateConfig {
  /** Minimum content length for non-tool-call responses (default: 1) */
  minContentLength: number;

  /** Whether to detect hallucination preamble patterns (default: true) */
  detectHallucinationPatterns: boolean;

  /** Whether to detect refusal patterns (default: false — many legitimate reasons) */
  detectRefusalPatterns: boolean;

  /** Max consecutive similar responses before flagging loop (default: 3) */
  maxLoopSimilarity: number;

  /**
   * Reasons that cause blocking (return passed=false).
   * Always includes 'empty_response'. Default also includes 'loop_detected'.
   * Use ['empty_response'] for permissive mode (warn only on everything else).
   */
  blockedReasons: QualityGateReason[];
}

/** Default configuration */
export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  minContentLength: 1,
  detectHallucinationPatterns: true,
  detectRefusalPatterns: false,
  maxLoopSimilarity: 3,
  blockedReasons: ['empty_response', 'loop_detected'],
};

// ============================================================
// Pre-built Pattern Rules
// ============================================================

/**
 * Hallucination preamble patterns — text the LLM inserts when it's
 * "stalling" or fabricating context about itself.
 */
const HALLUCINATION_PATTERNS: PatternRule[] = [
  {
    pattern: /\bAs an AI language model\b/i,
    reason: 'hallucination_pattern',
    threshold: 1,
  },
  {
    pattern: /\bI don't have (real-time|live|internet|browser) access\b/i,
    reason: 'hallucination_pattern',
    threshold: 1,
  },
  {
    pattern: /\bAccording to my training (data|cutoff)\b/i,
    reason: 'hallucination_pattern',
    threshold: 1,
  },
  {
    pattern: /\bI am (an AI|a language model|a large language model|a chatbot)\b/i,
    reason: 'hallucination_pattern',
    threshold: 1,
  },
];

/**
 * Refusal patterns — the LLM declining to help.
 * Disabled by default because many refusals are legitimate.
 * Enable when building agentic workflows that should NEVER refuse.
 */
const REFUSAL_PATTERNS: PatternRule[] = [
  {
    pattern: /\bI cannot (help|assist|comply|do that|provide)\b/i,
    reason: 'refusal_pattern',
    threshold: 1,
  },
  {
    pattern: /\bI'm (not able|unable) to\b/i,
    reason: 'refusal_pattern',
    threshold: 1,
  },
  {
    pattern: /\bI'm sorry, but I (can't|cannot|won't)\b/i,
    reason: 'refusal_pattern',
    threshold: 1,
  },
];

// ============================================================
// QualityGate Implementation
// ============================================================

/**
 * Quality Gate — validates LLM output quality before it enters
 * the conversation context.
 *
 * Instance per agent session. Maintains internal ring buffer for
 * loop detection.
 *
 * @example
 * ```typescript
 * const gate = new QualityGate({ blockedReasons: ['empty_response', 'loop_detected'] });
 * const result = gate.check(response.content, state);
 * if (!result.passed) {
 *   // Inject correction message for LLM
 *   messages.push({ role: 'user', content: result.feedback });
 * }
 * ```
 */
export class QualityGate {
  private config: QualityGateConfig;
  /** Ring buffer of last N response hashes for loop detection */
  private recentHashes: string[] = [];
  /** Track consecutive matches per pattern rule */
  private matchCounters = new Map<QualityGateReason, number>();

  constructor(config: Partial<QualityGateConfig> = {}) {
    this.config = { ...DEFAULT_QUALITY_GATE_CONFIG, ...config };
  }

  /**
   * Check LLM output quality.
   *
   * @param content      - LLM response text content
   * @param _state       - Agent loop state (reserved for future use, e.g. task goal alignment)
   * @returns Check result — .passed indicates whether output is acceptable
   */
  check(content: string, _state: AgentState): QualityGateCheck {
    const reasons: QualityGateReason[] = [];
    let feedback: string | undefined;

    // ── Rule 1: Empty response ──
    const trimmed = content.trim();
    if (trimmed.length < this.config.minContentLength) {
      reasons.push('empty_response');
      feedback = 'Your previous response was empty. Please provide a substantive answer.';
    }

    // ── Rule 2: Hallucination patterns ──
    if (this.config.detectHallucinationPatterns && trimmed.length > 0) {
      for (const rule of HALLUCINATION_PATTERNS) {
        if (rule.pattern.test(trimmed)) {
          const count = (this.matchCounters.get(rule.reason) ?? 0) + 1;
          this.matchCounters.set(rule.reason, count);
          if (count >= rule.threshold) {
            reasons.push(rule.reason);
            if (!feedback) {
              feedback =
                'Avoid stating what you "are" or "cannot do". ' +
                'Focus on the task directly without meta-commentary about your capabilities.';
            }
          }
          break; // One hallucination pattern is enough
        }
      }
      // Reset counters for responses that don't match
      if (!reasons.includes('hallucination_pattern')) {
        this.matchCounters.delete('hallucination_pattern');
      }
    }

    // ── Rule 3: Loop detection ──
    if (trimmed.length > 0) {
      const currentHash = this.contentHash(trimmed);
      this.recentHashes.push(currentHash);

      // Keep only last N
      if (this.recentHashes.length > this.config.maxLoopSimilarity) {
        this.recentHashes.shift();
      }

      // Check if all recent hashes are the same (stuck in a loop)
      if (
        this.recentHashes.length >= this.config.maxLoopSimilarity &&
        this.recentHashes.every(h => h === currentHash)
      ) {
        reasons.push('loop_detected');
        feedback =
          `You have given the same response ${this.recentHashes.length} times in a row. ` +
          'You appear to be stuck. Try a different approach or ask for clarification.';
        // Reset to avoid immediate re-triggering
        this.recentHashes = [];
      }
    }

    // ── Rule 4: Refusal patterns ──
    if (this.config.detectRefusalPatterns && trimmed.length > 0) {
      for (const rule of REFUSAL_PATTERNS) {
        if (rule.pattern.test(trimmed)) {
          reasons.push(rule.reason);
          if (!feedback) {
            feedback =
              'It appears you declined the request. If the task is within your capabilities, ' +
              'please attempt it. If there are blockers, explain specifically what they are.';
          }
          break;
        }
      }
    }

    // ── Determine if passed ──
    const blocked = reasons.some(r => this.config.blockedReasons.includes(r));
    const passed = !blocked;

    return {
      passed,
      feedback: blocked ? feedback : undefined,
      reasons,
    };
  }

  /**
   * Lightweight content hash for loop detection.
   * Normalizes whitespace and truncates to avoid storing full text.
   */
  private contentHash(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    // Use first 200 characters as the hash key — looped responses
    // are typically identical in their prefix
    return normalized.slice(0, 200);
  }

  /**
   * Update configuration at runtime.
   */
  setConfig(update: Partial<QualityGateConfig>): void {
    this.config = { ...this.config, ...update };
  }

  /**
   * Get current configuration.
   */
  getConfig(): QualityGateConfig {
    return { ...this.config };
  }

  /**
   * Reset internal state (loop history, match counters).
   */
  reset(): void {
    this.recentHashes = [];
    this.matchCounters.clear();
  }
}
