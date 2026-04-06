import type { Tool } from '../types.js';
import { discovery } from './discovery.js';

export function createLoadSkillTool(): Tool {
  return {
    name: 'load_skill',
    description: 'Load a SKILL by name to get specialized instructions and workflows',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the SKILL to load',
        },
      },
      required: ['name'],
    },
    execute: async (args: Record<string, unknown>) => {
      const name = args.name as string;
      const skill = discovery.get(name);

      if (!skill) {
        const availableSkills = discovery
          .list()
          .map((s) => s.name)
          .join(', ');
        return `SKILL not found: ${name}\n\nAvailable skills: ${availableSkills || 'none'}`;
      }

      return `---\nSKILL: ${skill.name}\nDescription: ${skill.description}\n---\n\n${skill.content}`;
    },
  };
}

export function createListSkillsTool(): Tool {
  return {
    name: 'list_skills',
    description: 'List all available SKILLs',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const skills = discovery.list();

      if (skills.length === 0) {
        return 'No SKILLs available. Add SKILLs to .primo-agent/skills/, .agents/skills/, or .claude/skills/';
      }

      let result = 'Available SKILLs:\n\n';
      for (const skill of skills) {
        result += `- ${skill.name}: ${skill.description}\n`;
      }

      return result;
    },
  };
}
