export * from './types.js';
export { schemas } from './types.js';
export { registry } from './registry.js';
export { delegation, DelegationManager, isolatedMessageFilter } from './delegation.js';
export { createDelegateToSubAgentTool, createListSubAgentsTool } from './tool.js';

import { registry } from './registry.js';
import { delegation } from './delegation.js';
import { createDelegateToSubAgentTool, createListSubAgentsTool } from './tool.js';
import type { SubAgentRegistration, DelegationConfig } from './types.js';
import type { Agent } from '../agent/index.js';
import type { Message } from '../types.js';

/**
 * Register a sub-agent with isolated context by default.
 * Isolated means the sub-agent gets only the delegated task, not the full parent conversation context.
 * This keeps the parent context clean and prevents token bloat.
 */
function registerIsolated(
  config: SubAgentRegistration & {
    /** Override the default message filtering if needed */
    messageFilter?: (ctx: {
      messages: Message[];
      subAgentName: string;
      prompt: string;
    }) => Message[];
  }
): void {
  const delegationConfig: DelegationConfig | undefined = config.messageFilter
    ? { messageFilter: config.messageFilter }
    : { messageFilter: isolatedMessageFilter };

  registry.register({
    ...config,
  });
}

export const SubAgent = {
  register: (config: SubAgentRegistration) => registry.register(config),
  registerIsolated,
  list: () => registry.list(),
  get: (name: string) => registry.get(name),
  getAgent: (name: string) => registry.getAgent(name),
  getTools: (name: string) => registry.getTools(name),
  delegate: (name: string, prompt: string, messages: Message[], config?: DelegationConfig) =>
    delegation.delegate(name, prompt, messages, config),
  createDelegateToSubAgentTool,
  createListSubAgentsTool,
};
