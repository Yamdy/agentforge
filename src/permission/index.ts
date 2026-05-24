/**
 * Permission System Module
 *
 * Provides pattern-based permission control for tool execution.
 * Inspired by OpenCode's permission system.
 *
 * @example
 * ```typescript
 * import { PermissionManager, defaultRules } from 'agentforge/permission';
 *
 * const manager = new PermissionManager();
 * manager.setRules(defaultRules);
 *
 * // Check before executing a bash command
 * const result = manager.check(sessionId, 'bash', 'git status');
 * if (result.action === 'allow') {
 *   // Proceed with execution
 * } else if (result.action === 'ask') {
 *   // Prompt user with ctx.ask(result.askPrompt)
 * } else {
 *   // Deny execution
 * }
 * ```
 */

// Types
export type {
  PermissionAction,
  PermissionRule,
  Ruleset,
  ToolPermissionCategory,
  PermissionCheckResult,
  PermissionRequest,
  PermissionResponse,
  PermissionConfig,
  PermissionManagerConfig,
} from './types';

// Utilities
export { parsePermissionConfig } from './types';

// Manager
export { PermissionManager, matchPattern } from './manager';

// Presets
export {
  defaultRules,
  strictRules,
  permissiveRules,
  readOnlyRules,
  presets,
} from './presets';
