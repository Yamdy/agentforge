import type { AgentPreset } from './types.js';

/**
 * Researcher Preset
 *
 * Sub-agent for information gathering and research.
 * Has web access but cannot modify local files.
 */
export const researcherPreset: AgentPreset = {
  id: 'researcher',
  name: 'Researcher',
  description:
    'Sub-agent for information gathering and research. Has web access but cannot modify local files.',
  mode: 'subagent',
  permissionMode: 'full-auto',
  permissions: [
    { tool: 'file_read', action: 'allow' },
    { tool: 'file_list', action: 'allow' },
    { tool: 'http', action: 'allow' },
    { tool: 'web_search', action: 'allow' },
    { tool: 'web_fetch', action: 'allow' },
    { tool: '*', action: 'deny' },
  ],
  defaultModel: 'claude-haiku-4-5',
  systemPromptFragment: `You are a research assistant specialized in gathering information.
Focus on finding accurate, relevant information from web and local sources.
Provide concise summaries with sources.`,
};
