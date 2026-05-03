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

export {
  type DenialTrackerConfig,
  DEFAULT_DENIAL_TRACKER_CONFIG,
  DenialTracker,
} from './denial-tracker.js';

export { PERMISSION_PRESETS, getPermissionPreset, listPermissionPresets } from './presets.js';

export {
  type PermissionClassifier,
  type PermissionClassifierContext,
  type PermissionClassification,
  type ClassificationConfidence,
  NoopPermissionClassifier,
  safeClassify,
} from './classifier.js';
