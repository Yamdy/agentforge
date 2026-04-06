export * from './types.js';
export { discovery } from './discovery.js';
export { createLoadSkillTool, createListSkillsTool } from './tool.js';

import { discovery } from './discovery.js';
import { createLoadSkillTool, createListSkillsTool } from './tool.js';

export const Skill = {
  discover: () => discovery.discover(),
  list: () => discovery.list(),
  get: (name: string) => discovery.get(name),
  refresh: () => discovery.refresh(),
  createLoadSkillTool,
  createListSkillsTool,
};
