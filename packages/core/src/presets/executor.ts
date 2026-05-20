import type { AgentPreset } from './types.js';

/**
 * Executor Preset
 *
 * Default agent with full permissions for general tasks.
 * Sensitive operations (file write, file delete, shell exec) require confirmation.
 */
export const executorPreset: AgentPreset = {
  id: 'executor',
  name: 'Executor',
  description: 'Default agent with full permissions for general tasks.',
  mode: 'primary',
  permissionMode: 'interactive',
  permissions: [
    { tool: '*', action: 'allow' },
    { tool: 'file_write', action: 'ask' },
    { tool: 'file_delete', action: 'ask' },
    { tool: 'shell_exec', action: 'ask' },
  ],
  defaultModel: 'claude-sonnet-4-6',
  systemPromptFragment: `You are a capable assistant that can execute tasks using available tools.
Always think step by step before taking actions.`,
};
