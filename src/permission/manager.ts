/**
 * Permission Manager
 *
 * Manages permission rules and evaluates tool execution requests.
 * Inspired by OpenCode's pattern-based permission system:
 * - Rules are evaluated top-to-bottom, last match wins
 * - Supports per-agent rule overrides (agent rules take precedence)
 * - Tracks "always allow" decisions per session
 * - Configurable default action for unmatched rules (default: 'ask')
 */

import { randomUUID } from 'node:crypto';
import type {
  Ruleset,
  PermissionRule,
  PermissionAction,
  PermissionCheckResult,
  PermissionRequest,
  PermissionResponse,
  ToolPermissionCategory,
  PermissionManagerConfig,
} from './types';
import { strictRules } from './presets';

// ========== Wildcard Pattern Matching ==========

/**
 * Match a glob pattern against an input string.
 * Supports:
 * - `*` matches zero or more of any character
 * - `?` matches exactly one character
 * - All other characters match literally
 */
export function matchPattern(pattern: string, input: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .split('')
    .map((ch) => {
      switch (ch) {
        case '*':
          return '.*';
        case '?':
          return '.';
        case '.':
          return '\\.';
        case '/':
          return '\\/';
        case '+':
          return '\\+';
        case '(':
          return '\\(';
        case ')':
          return '\\)';
        case '[':
          return '\\[';
        case ']':
          return '\\]';
        case '{':
          return '\\{';
        case '}':
          return '\\}';
        case '^':
          return '\\^';
        case '$':
          return '\\$';
        case '|':
          return '\\|';
        case '\\':
          return '\\\\';
        default:
          return ch;
      }
    })
    .join('');

  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(input);
}

// ========== Permission Manager ==========

export class PermissionManager {
  private config: { defaultAction: PermissionAction };
  private globalRules: Ruleset = [];
  private agentRules: Map<string, Ruleset> = new Map();
  private sessionAlwaysAllowed: Map<string, PermissionRule[]> = new Map();
  private pendingRequests: Map<string, PermissionRequest> = new Map();

  /**
   * Create a new PermissionManager instance.
   *
   * @param config - Configuration options
   *
   * @example
   * ```typescript
   * // Default safe mode (recommended)
   * const manager = new PermissionManager();
   * manager.setRules(defaultRules);
   *
   * // Backward-compatible mode
   * const manager = new PermissionManager({ defaultAction: 'allow' });
   *
   * // Strict mode
   * const manager = new PermissionManager({ strict: true });
   * ```
   */
  constructor(config?: PermissionManagerConfig) {
    // Strict mode: use strictRules + defaultAction='deny'
    if (config?.strict) {
      this.config = { defaultAction: 'deny' };
      this.globalRules = [...strictRules];
    } else {
      // Normal mode: defaultAction='ask'
      this.config = {
        defaultAction: config?.defaultAction ?? 'ask',
      };
    }
  }

  /**
   * Get the current default action configuration.
   */
  getDefaultAction(): PermissionAction {
    return this.config.defaultAction;
  }

  /**
   * Set global permission rules.
   */
  setRules(rules: Ruleset): void {
    this.globalRules = rules;
  }

  /**
   * Get current global rules.
   */
  getRules(): Ruleset {
    return [...this.globalRules];
  }

  /**
   * Set per-agent permission rules.
   * Agent rules are merged with global rules, agent rules take precedence.
   */
  setAgentRules(agentName: string, rules: Ruleset): void {
    this.agentRules.set(agentName, rules);
  }

  /**
   * Get rules for a specific agent.
   */
  getAgentRules(agentName: string): Ruleset | undefined {
    return this.agentRules.get(agentName);
  }

  /**
   * Resolve effective rules for an agent.
   * Merges global + agent rules. Agent rules come after global rules,
   * so they win on last-match-wins evaluation.
   */
  resolveRules(agentName?: string): Ruleset {
    const rules = [...this.globalRules];

    if (agentName) {
      const agentSpecific = this.agentRules.get(agentName);
      if (agentSpecific) {
        rules.push(...agentSpecific);
      }
    }

    return rules;
  }

  /**
   * Check permission for a tool invocation.
   *
   * @param sessionId - Current session ID
   * @param category - Tool permission category (e.g., "bash", "edit")
   * @param input - Tool input string for pattern matching
   * @param agentName - Optional agent name for per-agent rules
   * @returns Permission check result
   */
  check(
    sessionId: string,
    category: string,
    input: string,
    agentName?: string
  ): PermissionCheckResult {
    // 1. Check session "always allowed" rules first
    const alwaysRules = this.sessionAlwaysAllowed.get(sessionId);
    if (alwaysRules) {
      for (const rule of alwaysRules) {
        if (rule.permission === category && matchPattern(rule.pattern, input)) {
          return {
            action: 'allow',
            matchedPattern: rule.pattern,
            matchedRule: rule,
          };
        }
      }
    }

    // 2. Resolve effective rules (global + agent)
    const rules = this.resolveRules(agentName);

    // 3. Evaluate rules: last match wins
    let lastMatch: { rule: PermissionRule; index: number } | null = null;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.permission === category && matchPattern(rule.pattern, input)) {
        lastMatch = { rule, index: i };
      }
      // Also check wildcard category "*"
      if (rule.permission === '*' && matchPattern(rule.pattern, input)) {
        lastMatch = { rule, index: i };
      }
    }

    // 4. If no rule matched, use configured default action
    if (!lastMatch) {
      const result: PermissionCheckResult = {
        action: this.config.defaultAction,
      };

      // 5. If default action is 'ask', prepare the prompt
      if (this.config.defaultAction === 'ask') {
        const suggestedPatterns = this.generateSuggestedPatterns(category, input);
        result.askPrompt = {
          message: `Permission required: ${category} (no matching rule)`,
          choices: ['Allow once', 'Always allow', 'Deny'],
          defaultChoice: 'Deny',
        };
        result.suggestedPatterns = suggestedPatterns;
      }

      return result;
    }

    const matchedRule = lastMatch.rule;
    const result: PermissionCheckResult = {
      action: matchedRule.action,
      matchedPattern: matchedRule.pattern,
      matchedRule,
    };

    // 5. If action is 'ask', prepare the prompt
    if (matchedRule.action === 'ask') {
      const suggestedPatterns = this.generateSuggestedPatterns(category, input);
      result.askPrompt = {
        message: `Permission required: ${category}`,
        choices: ['Allow once', 'Always allow', 'Deny'],
        defaultChoice: 'Allow once',
      };
      result.suggestedPatterns = suggestedPatterns;
    }

    return result;
  }

  /**
   * Record an "always allow" decision for a session.
   */
  setAlwaysAllowed(sessionId: string, category: string, pattern: string): void {
    let rules = this.sessionAlwaysAllowed.get(sessionId);
    if (!rules) {
      rules = [];
      this.sessionAlwaysAllowed.set(sessionId, rules);
    }
    // Add the rule if not already present
    const exists = rules.some((r) => r.permission === category && r.pattern === pattern);
    if (!exists) {
      rules.push({ permission: category, action: 'allow', pattern });
    }
  }

  /**
   * Clear all "always allowed" rules for a session.
   */
  clearSessionAlwaysAllowed(sessionId: string): void {
    this.sessionAlwaysAllowed.delete(sessionId);
  }

  /**
   * Check if a tool invocation is always allowed for a session.
   */
  isAlwaysAllowed(sessionId: string, category: string, input: string): boolean {
    const rules = this.sessionAlwaysAllowed.get(sessionId);
    if (!rules) return false;
    return rules.some(
      (r) => r.permission === category && matchPattern(r.pattern, input)
    );
  }

  /**
   * Create a permission request (for async UI integration).
   */
  createRequest(
    sessionId: string,
    category: string,
    input: string
  ): PermissionRequest {
    const request: PermissionRequest = {
      id: randomUUID(),
      sessionId,
      permission: category,
      input,
      suggestedPatterns: this.generateSuggestedPatterns(category, input),
      timestamp: new Date(),
    };
    this.pendingRequests.set(request.id, request);
    return request;
  }

  /**
   * Resolve a pending permission request.
   */
  resolveRequest(response: PermissionResponse): void {
    const request = this.pendingRequests.get(response.requestId);
    if (!request) return;

    if (response.decision === 'allow' && response.always) {
      // Apply all suggested patterns as always-allowed
      for (const pattern of request.suggestedPatterns) {
        this.setAlwaysAllowed(request.sessionId, request.permission, pattern);
      }
    }

    this.pendingRequests.delete(response.requestId);
  }

  /**
   * Generate suggested patterns for "always allow".
   * For example, for "bash" with input "git status --porcelain",
   * suggest "git status *" as a safe prefix.
   */
  private generateSuggestedPatterns(category: string, input: string): string[] {
    switch (category) {
      case 'bash': {
        // Suggest the command prefix (first word + wildcard)
        const parts = input.trim().split(/\s+/);
        if (parts.length > 1) {
          return [`${parts[0]} *`, `${parts[0]} ${parts[1]} *`];
        }
        return [parts[0]];
      }
      case 'read':
      case 'edit': {
        // Suggest the directory prefix
        const lastSlash = input.lastIndexOf('/');
        if (lastSlash > 0) {
          return [`${input.substring(0, lastSlash + 1)}*`];
        }
        return ['*'];
      }
      default:
        return ['*'];
    }
  }
}
