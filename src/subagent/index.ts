export * from './types.js';
export { schemas } from './types.js';
export { registry } from './registry.js';
export { delegation } from './delegation.js';
export { createDelegateToSubAgentTool, createListSubAgentsTool } from './tool.js';

import { registry } from './registry.js';
import { delegation } from './delegation.js';
import { createDelegateToSubAgentTool, createListSubAgentsTool } from './tool.js';

export const SubAgent = {
  register: (config: any) => registry.register(config),
  list: () => registry.list(),
  get: (name: string) => registry.get(name),
  getAgent: (name: string) => registry.getAgent(name),
  getTools: (name: string) => registry.getTools(name),
  delegate: (name: string, prompt: string, messages: any[], config?: any) =>
    delegation.delegate(name, prompt, messages, config),
  createDelegateToSubAgentTool,
  createListSubAgentsTool,
};
