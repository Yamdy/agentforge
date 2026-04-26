/**
 * AgentForge Permission Policy
 *
 * Defines the policy engine for tool execution permissions.
 * Evaluates whether a tool call should be allowed, denied, or require
 * human approval based on:
 * 1. Tool-level policies (override everything)
 * 2. requiresApproval flag on ToolDefinition
 * 3. riskLevel-based policies
 * 4. Default fallback policy
 *
 * @see design/17-SECURITY.md Section 4.1
 */

import type { RiskLevel, ToolDefinition } from '../../core/interfaces.js';

// ============================================================
// Policy Types
// ============================================================

/**
 * Policy decision for a tool call.
 * - 'allow': Execute without asking
 * - 'ask': Ask human for permission
 * - 'deny': Deny execution
 */
export type PolicyDecision = 'allow' | 'ask' | 'deny';

/**
 * Configuration for permission policy evaluation.
 */
export interface PermissionPolicy {
  /** Policy for each risk level */
  riskPolicies: Record<RiskLevel, PolicyDecision>;
  /** Default policy for unknown tools */
  defaultPolicy: PolicyDecision;
  /** Tool-level override policies (tool name → decision) */
  toolPolicies: Record<string, PolicyDecision>;
  /** Whether to enforce ToolDefinition.requiresApproval as 'ask' */
  enforceApprovalFlag: boolean;
}

// ============================================================
// Default Policy
// ============================================================

/**
 * Default permission policy — safe-by-default.
 */
export const DEFAULT_PERMISSION_POLICY: PermissionPolicy = {
  riskPolicies: {
    low: 'allow',
    medium: 'allow',
    high: 'ask',
    critical: 'deny',
  },
  defaultPolicy: 'ask',
  toolPolicies: {},
  enforceApprovalFlag: true,
};

// ============================================================
// Evaluation Function
// ============================================================

/**
 * Evaluate the permission decision for a tool call.
 *
 * Evaluation order (first match wins):
 * 1. Tool-level policy (toolPolicies[tool.name])
 * 2. requiresApproval flag (if enforceApprovalFlag is true)
 * 3. riskLevel-based policy (riskPolicies[tool.riskLevel ?? 'medium'])
 * 4. Default fallback policy
 */
export function evaluatePermission(tool: ToolDefinition, policy: PermissionPolicy): PolicyDecision {
  // 1. Tool-level policy overrides everything
  const toolDecision = policy.toolPolicies[tool.name];
  if (toolDecision !== undefined) {
    return toolDecision;
  }

  // 2. requiresApproval flag — forces 'ask'
  if (policy.enforceApprovalFlag && tool.requiresApproval === true) {
    return 'ask';
  }

  // 3. riskLevel-based policy
  const level = tool.riskLevel ?? 'medium';
  const riskDecision = policy.riskPolicies[level];
  if (riskDecision !== undefined) {
    return riskDecision;
  }

  // 4. Default fallback
  return policy.defaultPolicy;
}

/**
 * Create a permission policy with partial overrides.
 */
export function createPermissionPolicy(
  overrides: Partial<PermissionPolicy> = {}
): PermissionPolicy {
  return {
    riskPolicies: {
      ...DEFAULT_PERMISSION_POLICY.riskPolicies,
      ...(overrides.riskPolicies ?? {}),
    },
    defaultPolicy: overrides.defaultPolicy ?? DEFAULT_PERMISSION_POLICY.defaultPolicy,
    toolPolicies: {
      ...DEFAULT_PERMISSION_POLICY.toolPolicies,
      ...(overrides.toolPolicies ?? {}),
    },
    enforceApprovalFlag:
      overrides.enforceApprovalFlag ?? DEFAULT_PERMISSION_POLICY.enforceApprovalFlag,
  };
}
