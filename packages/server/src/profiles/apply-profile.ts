import type { Agent } from '@primo-ai/core';
import type { AgentProfile } from '@primo-ai/sdk';

export function applyProfile(agent: Agent, profile: AgentProfile): void {
  for (const pluginFactory of profile.plugins ?? []) {
    agent.use(pluginFactory);
  }
  for (const tool of profile.tools ?? []) {
    agent.toolRegistry.register(tool);
  }
}
