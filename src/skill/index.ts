export * from './types.js';
export { discovery } from './discovery.js';
export { createLoadSkillTool, createListSkillsTool, createSearchSkillsTool } from './tool.js';

import { discovery } from './discovery.js';
import { createLoadSkillTool, createListSkillsTool, createSearchSkillsTool } from './tool.js';

export const Skill = {
  discover: () => discovery.discover(),
  list: () => discovery.list(),
  get: (name: string) => discovery.get(name),
  findRelevant: (query: string) => discovery.findRelevantSkills(query),
  refresh: () => discovery.refresh(),
  createLoadSkillTool,
  createListSkillsTool,
  createSearchSkillsTool,
};
