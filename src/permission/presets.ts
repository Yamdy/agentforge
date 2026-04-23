/**
 * Built-in Permission Rule Presets
 *
 * Provide common permission configurations for different use cases.
 */

import type { Ruleset } from './types';

/**
 * Default rules: read/glob/grep allowed, bash/edit/fetch require confirmation.
 * This is the standard starting point for most users.
 */
export const defaultRules: Ruleset = [
  // Read operations: allowed by default
  { permission: 'read', action: 'allow', pattern: '*' },
  { permission: 'glob', action: 'allow', pattern: '*' },
  { permission: 'grep', action: 'allow', pattern: '*' },
  { permission: 'find', action: 'allow', pattern: '*' },
  { permission: 'ls', action: 'allow', pattern: '*' },

  // Write operations: require confirmation
  { permission: 'edit', action: 'ask', pattern: '*' },
  { permission: 'bash', action: 'ask', pattern: '*' },
  { permission: 'fetch', action: 'allow', pattern: '*' },

  // Search operations: allowed
  { permission: 'search', action: 'allow', pattern: '*' },
  { permission: 'webfetch', action: 'ask', pattern: '*' },

  // .env files: deny read by default
  { permission: 'read', action: 'deny', pattern: '*.env' },
  { permission: 'read', action: 'deny', pattern: '*.env.*' },
  { permission: 'read', action: 'allow', pattern: '*.env.example' },

  // Bash safety: deny dangerous commands
  { permission: 'bash', action: 'deny', pattern: 'rm -rf /*' },
  { permission: 'bash', action: 'deny', pattern: 'rm -rf /' },
  { permission: 'bash', action: 'deny', pattern: ':(){ :|:& };:' },
];

/**
 * Strict rules: all operations require confirmation except read.
 * Use for untrusted environments or sensitive projects.
 */
export const strictRules: Ruleset = [
  // Default: ask for everything
  { permission: '*', action: 'ask', pattern: '*' },

  // Read is allowed
  { permission: 'read', action: 'allow', pattern: '*' },
  { permission: 'glob', action: 'allow', pattern: '*' },
  { permission: 'grep', action: 'allow', pattern: '*' },
  { permission: 'ls', action: 'allow', pattern: '*' },

  // .env files always denied
  { permission: 'read', action: 'deny', pattern: '*.env' },
  { permission: 'read', action: 'deny', pattern: '*.env.*' },
  { permission: 'edit', action: 'deny', pattern: '*.env' },
  { permission: 'edit', action: 'deny', pattern: '*.env.*' },

  // Dangerous commands always denied
  { permission: 'bash', action: 'deny', pattern: 'rm -rf /*' },
  { permission: 'bash', action: 'deny', pattern: 'rm -rf /' },
];

/**
 * Permissive rules: all operations allowed.
 * Use for trusted environments or development.
 */
export const permissiveRules: Ruleset = [
  { permission: '*', action: 'allow', pattern: '*' },
  // Still deny .env by default as a safety net
  { permission: 'read', action: 'deny', pattern: '*.env' },
  { permission: 'read', action: 'deny', pattern: '*.env.*' },
  { permission: 'read', action: 'allow', pattern: '*.env.example' },
];

/**
 * Read-only rules: only read operations allowed, no modifications.
 * Use for code review or analysis agents.
 */
export const readOnlyRules: Ruleset = [
  // Allow all read operations
  { permission: 'read', action: 'allow', pattern: '*' },
  { permission: 'glob', action: 'allow', pattern: '*' },
  { permission: 'grep', action: 'allow', pattern: '*' },
  { permission: 'ls', action: 'allow', pattern: '*' },
  { permission: 'find', action: 'allow', pattern: '*' },
  { permission: 'search', action: 'allow', pattern: '*' },

  // Deny all write operations
  { permission: 'edit', action: 'deny', pattern: '*' },
  { permission: 'bash', action: 'deny', pattern: '*' },

  // .env denied
  { permission: 'read', action: 'deny', pattern: '*.env' },
  { permission: 'read', action: 'deny', pattern: '*.env.*' },
];

/**
 * Map of preset names to rulesets.
 */
export const presets: Record<string, Ruleset> = {
  default: defaultRules,
  strict: strictRules,
  permissive: permissiveRules,
  'read-only': readOnlyRules,
};
