/**
 * Permission System Types
 *
 * Inspired by OpenCode's pattern-based permission system.
 * Each rule matches against tool input using glob patterns,
 * with the last matching rule winning.
 */

import type { AskInput } from '../tool/context';

// ========== Actions ==========

/**
 * Permission action to take when a rule matches.
 * - 'allow': Execute without prompting
 * - 'deny': Block execution
 * - 'ask': Prompt user for approval
 */
export type PermissionAction = 'allow' | 'deny' | 'ask';

// ========== Rules ==========

/**
 * A single permission rule.
 * Rules are evaluated in order, with the last matching rule winning.
 */
export interface PermissionRule {
  /** Tool category (e.g., "bash", "read", "edit") */
  permission: string;
  /** Action to take when this rule matches */
  action: PermissionAction;
  /** Glob pattern to match against tool input */
  pattern: string;
}

/**
 * A Ruleset is an ordered list of permission rules.
 * Rules are evaluated top-to-bottom, last match wins.
 */
export type Ruleset = PermissionRule[];

// ========== Tool Permission Declaration ==========

/**
 * Permission category declared by a tool.
 * Tools declare their category so the permission system
 * knows which rules to apply.
 */
export interface ToolPermissionCategory {
  /** Category name for permission rules (e.g., "bash", "edit", "read") */
  category: string;
  /** Extract the input string from tool args for pattern matching */
  extractInput: (args: unknown) => string;
}

// ========== Check Result ==========

/**
 * Result of a permission check.
 */
export interface PermissionCheckResult {
  /** The action determined by the rules */
  action: PermissionAction;
  /** The pattern that matched (for debugging/logging) */
  matchedPattern?: string;
  /** The rule that matched */
  matchedRule?: PermissionRule;
  /** If action is 'ask', provide prompt for ctx.ask() */
  askPrompt?: AskInput;
  /** Suggested patterns for "always allow" (used by UI) */
  suggestedPatterns?: string[];
}

// ========== Permission Event ==========

/**
 * Permission request event for UI integration.
 */
export interface PermissionRequest {
  /** Unique request ID */
  id: string;
  /** Session ID */
  sessionId: string;
  /** Tool category */
  permission: string;
  /** Input that triggered the check */
  input: string;
  /** Suggested patterns for "always allow" */
  suggestedPatterns: string[];
  /** Timestamp */
  timestamp: Date;
}

/**
 * Permission response from user.
 */
export interface PermissionResponse {
  /** Request ID being responded to */
  requestId: string;
  /** User's decision */
  decision: 'allow' | 'deny';
  /** Whether to remember this decision (always allow) */
  always?: boolean;
}

// ========== Utility Types ==========

/**
 * Permission rules config format (simpler JSON representation).
 * Maps category -> pattern -> action.
 */
export type PermissionConfig = {
  [category: string]: PermissionAction | { [pattern: string]: PermissionAction };
};

/**
 * Convert PermissionConfig to Ruleset.
 */
export function parsePermissionConfig(config: PermissionConfig): Ruleset {
  const rules: Ruleset = [];

  for (const [category, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      // Simple format: "bash": "ask"
      rules.push({ permission: category, action: value, pattern: '*' });
    } else {
      // Granular format: "bash": { "*": "ask", "git *": "allow" }
      for (const [pattern, action] of Object.entries(value)) {
        rules.push({ permission: category, action, pattern });
      }
    }
  }

  return rules;
}
