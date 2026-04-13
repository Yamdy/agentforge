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
        return 'No SKILLs available. Add SKILLs to .agentforge/skills/, .agents/skills/, .claude/skills/, or skills/';
      }

      let result = 'Available SKILLs:\n\n';
      for (const skill of skills) {
        const category = skill.frontmatter?.category
          ? `[${skill.frontmatter.category as string}] `
          : '';
        result += `- ${category}**${skill.name}**: ${skill.description}\n`;
      }

      return result;
    },
  };
}

export function createSearchSkillsTool(): Tool {
  return {
    name: 'search_skills',
    description:
      'Search for relevant SKILLs by query. Use this to find skills related to current task',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (keywords related to the task)',
        },
      },
      required: ['query'],
    },
    execute: async (args: Record<string, unknown>) => {
      const query = args.query as string;
      const skills = discovery.findRelevantSkills(query);

      if (skills.length === 0) {
        return `No relevant SKILLs found for query: "${query}"`;
      }

      let result = `Found ${skills.length} relevant SKILL(s) for "${query}":\n\n`;
      for (const skill of skills) {
        const category = skill.frontmatter?.category
          ? `[${skill.frontmatter.category as string}] `
          : '';
        result += `- ${category}**${skill.name}**: ${skill.description}\n`;
      }

      result += '\nUse `load_skill` with the skill name to load the full skill content.';
      return result;
    },
  };
}
