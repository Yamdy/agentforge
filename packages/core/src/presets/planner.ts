import type { AgentPreset } from './types.js';

/**
 * Planner Preset
 *
 * Read-only agent for analysis, planning, and review.
 * Cannot modify files or execute commands - only read and analyze.
 */
export const plannerPreset: AgentPreset = {
  id: 'planner',
  name: 'Planner',
  description:
    'Read-only agent for analysis, planning, and review. Cannot modify files or execute commands.',
  mode: 'primary',
  permissionMode: 'plan-only',
  permissions: [
    { tool: 'file_read', action: 'allow' },
    { tool: 'file_list', action: 'allow' },
    { tool: 'glob', action: 'allow' },
    { tool: 'grep', action: 'allow' },
    { tool: 'http', action: 'allow' },
    { tool: 'web_search', action: 'allow' },
    { tool: 'web_fetch', action: 'allow' },
    { tool: '*', action: 'deny' },
  ],
  defaultModel: 'claude-sonnet-4-6',
  systemPromptFragment: `You are a planning and analysis assistant.
Your role is to analyze information, create plans, and provide recommendations.
You CANNOT modify files or execute commands - only read and analyze.`,
};
