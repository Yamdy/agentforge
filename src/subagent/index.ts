export * from './types.js';
export { schemas } from './types.js';
export { registry } from './registry.js';
export { delegation } from './delegation.js';
export { createDelegateToSubAgentTool, createListSubAgentsTool } from './tool.js';

import { registry } from './registry.js';
import { delegation } from './delegation.js';
import { createDelegateToSubAgentTool, createListSubAgentsTool } from './tool.js';
import type { SubAgentRegistration, DelegationConfig } from './types.js';
import type { Message } from '../types.js';

export const SubAgent = {
  register: (config: SubAgentRegistration) => registry.register(config),
  list: () => registry.list(),
  get: (name: string) => registry.get(name),
  getAgent: (name: string) => registry.getAgent(name),
  getTools: (name: string) => registry.getTools(name),
  delegate: (name: string, prompt: string, messages: Message[], config?: DelegationConfig) =>
    delegation.delegate(name, prompt, messages, config),
  createDelegateToSubAgentTool,
  createListSubAgentsTool,
};
