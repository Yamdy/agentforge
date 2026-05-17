import type { AgentProfile } from '@primo-ai/sdk';
import { codingAgentProfile } from './coding-agent.js';
import { businessAgentProfile } from './business-agent.js';
import { personalAgentProfile } from './personal-agent.js';
import { dataAgentProfile } from './data-agent.js';

export { ProfileLoader, mergeProfiles } from './profile-loader.js';
export { applyProfile } from './apply-profile.js';
export { codingAgentProfile } from './coding-agent.js';
export { businessAgentProfile } from './business-agent.js';
export { personalAgentProfile } from './personal-agent.js';
export { dataAgentProfile } from './data-agent.js';

const builtins: AgentProfile[] = [
  codingAgentProfile,
  businessAgentProfile,
  personalAgentProfile,
  dataAgentProfile,
];

export function builtinProfiles(): AgentProfile[] {
  return builtins;
}
