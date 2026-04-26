/**
 * AgentForge Permission Module
 *
 * @module
 */

export {
  type PermissionDecision,
  type PermissionAskOptions,
  type PermissionPrompt,
  type PermissionController,
  DefaultPermissionController,
} from './permission-controller.js';

export {
  type PolicyDecision,
  type PermissionPolicy,
  DEFAULT_PERMISSION_POLICY,
  evaluatePermission,
  createPermissionPolicy,
} from './permission-policy.js';

export {
  type PermissionGuardContext,
  evaluatePermissionGuard,
  createPermissionDeniedEvents,
  createPermissionPromptEvent,
  createPermissionDecisionEvent,
  handlePermissionAsk,
} from './permission-guard.js';
