/**
 * AgentForge Permission Presets
 *
 * Six production-validated permission modes inspired by ClaudeCode.
 * Each preset is a complete PermissionPolicy object ready for use.
 *
 * NOTE: Preset declaration order does NOT affect evaluation priority.
 * The evaluation algorithm in evaluatePermission() always follows:
 *   1. tool-level policy → 2. requiresApproval flag → 3. riskLevel → 4. defaultPolicy
 * regardless of which preset is used.
 *
 * @see design/17-SECURITY.md Section 4.1
 */

import type { PolicyDecision, PermissionPolicy } from './permission-policy.js';

// ============================================================
// Preset Helpers
// ============================================================

function riskPolicies(
  low: PolicyDecision,
  medium: PolicyDecision,
  high: PolicyDecision,
  critical: PolicyDecision
): PermissionPolicy['riskPolicies'] {
  return { low, medium, high, critical };
}

// ============================================================
// 6 Preset Permission Policies
// ============================================================

export const PERMISSION_PRESETS = {
  /**
   * Default: safe-by-default.
   * Ask for high/critical, allow low/medium.
   */
  default: {
    riskPolicies: riskPolicies('allow', 'allow', 'ask', 'ask'),
    defaultPolicy: 'ask' as PolicyDecision,
    toolPolicies: {},
    enforceApprovalFlag: true,
  },

  /**
   * Plan mode: read-only.
   * Deny all writes, allow reads via toolPolicies.
   */
  plan: {
    riskPolicies: riskPolicies('allow', 'deny', 'deny', 'deny'),
    defaultPolicy: 'deny' as PolicyDecision,
    toolPolicies: {
      read_file: 'allow' as PolicyDecision,
      glob: 'allow' as PolicyDecision,
      grep: 'allow' as PolicyDecision,
    },
    enforceApprovalFlag: true,
  },

  /**
   * Accept edits: auto-approve file writes/edits,
   * still ask for bash/network.
   */
  acceptEdits: {
    riskPolicies: riskPolicies('allow', 'allow', 'ask', 'ask'),
    defaultPolicy: 'ask' as PolicyDecision,
    toolPolicies: {
      write_file: 'allow' as PolicyDecision,
      edit_file: 'allow' as PolicyDecision,
    },
    enforceApprovalFlag: true,
  },

  /**
   * Bypass: skip all permission checks.
   * DANGEROUS — use only in sandbox.
   */
  bypass: {
    riskPolicies: riskPolicies('allow', 'allow', 'allow', 'allow'),
    defaultPolicy: 'allow' as PolicyDecision,
    toolPolicies: {},
    enforceApprovalFlag: false,
  },

  /**
   * Strict: deny everything except explicit allowlist.
   */
  strict: {
    riskPolicies: riskPolicies('deny', 'deny', 'deny', 'deny'),
    defaultPolicy: 'deny' as PolicyDecision,
    toolPolicies: {},
    enforceApprovalFlag: true,
  },

  /**
   * Dont ask: silently deny dangerous ops instead of asking.
   */
  dontAsk: {
    riskPolicies: riskPolicies('allow', 'allow', 'deny', 'deny'),
    defaultPolicy: 'deny' as PolicyDecision,
    toolPolicies: {},
    enforceApprovalFlag: true,
  },
} as const;

// ============================================================
// Helper Functions
// ============================================================

type PresetName = keyof typeof PERMISSION_PRESETS;

/**
 * Get a permission preset by name.
 * Throws if the preset name is not recognized.
 */
export function getPermissionPreset(name: string): PermissionPolicy {
  if (name in PERMISSION_PRESETS) {
    return PERMISSION_PRESETS[name as PresetName] as PermissionPolicy;
  }
  throw new Error(
    `Unknown permission preset: "${name}". Valid presets: ${listPermissionPresets().join(', ')}`
  );
}

/**
 * List all available permission preset names.
 */
export function listPermissionPresets(): string[] {
  return Object.keys(PERMISSION_PRESETS) as PresetName[];
}
