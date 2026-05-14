import type { A2AAgentCard, AgentSkill } from './types.js';

export interface AgentCardOptions {
  name: string;
  description: string;
  url: string;
  version: string;
  skills?: AgentSkill[];
  tools?: Array<{ name: string; description: string }>;
  provider?: { url: string; organization: string };
  streaming?: boolean;
  documentationUrl?: string;
  iconUrl?: string;
}

export function buildAgentCard(options: AgentCardOptions): A2AAgentCard {
  const explicitSkills = options.skills ?? [];
  const toolSkills: AgentSkill[] = (options.tools ?? []).map((t) => ({
    id: t.name,
    name: t.name,
    description: t.description,
    tags: ['tool'],
  }));

  return {
    name: options.name,
    description: options.description,
    version: options.version,
    url: options.url,
    skills: [...explicitSkills, ...toolSkills],
    capabilities: {
      streaming: options.streaming ?? true,
      pushNotifications: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    ...(options.provider && { provider: options.provider }),
    ...(options.documentationUrl && { documentationUrl: options.documentationUrl }),
    ...(options.iconUrl && { iconUrl: options.iconUrl }),
  };
}
