/**
 * Agent Preset Types
 *
 * Defines the structure for agent presets - pre-configured agent templates
 * that can be used directly or customized.
 */

/**
 * The mode of operation for an agent.
 * - 'primary': Main agent that users interact with directly
 * - 'subagent': Specialized agent spawned by a primary agent
 */
export type AgentMode = 'primary' | 'subagent';

/**
 * Permission action type for tool access control.
 */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * A single permission rule for tool access.
 */
export interface PermissionRule {
  /** Tool name or '*' for wildcard */
  tool: string;
  /** Action to take when tool is requested */
  action: PermissionAction;
}

/**
 * Permission mode determines the default behavior for tool access.
 * - 'full-auto': All tools allowed unless explicitly denied
 * - 'interactive': Sensitive tools require user confirmation
 * - 'plan-only': Only read operations allowed
 */
export type PermissionMode = 'full-auto' | 'interactive' | 'plan-only';

/**
 * Agent Preset - A pre-configured agent template.
 *
 * Presets provide sensible defaults for common agent use cases,
 * reducing boilerplate for users.
 */
export interface AgentPreset {
  /** Unique identifier for this preset */
  id: string;
  /** Display name for UI purposes */
  name: string;
  /** Description shown when selecting presets */
  description: string;
  /** Operating mode */
  mode: AgentMode;
  /** Default permission rules */
  permissions: PermissionRule[];
  /** Permission mode */
  permissionMode: PermissionMode;
  /** Optional default model (e.g., 'claude-sonnet-4-6') */
  defaultModel?: string;
  /** Optional system prompt fragment appended to base prompt */
  systemPromptFragment?: string;
  /** Whether to hide from preset selection UI */
  hidden?: boolean;
}

/**
 * Permission configuration derived from a preset.
 */
export interface PermissionConfig {
  mode: PermissionMode;
  rules: PermissionRule[];
}
