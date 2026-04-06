import type { Tool } from '../types.js';
import { registry } from './registry.js';
import { delegation } from './delegation.js';

export function createDelegateToSubAgentTool(): Tool {
  return {
    name: 'delegate_to_subagent',
    description: 'Delegate a task to a specialized sub-agent',
    parameters: {
      type: 'object',
      properties: {
        subagent: {
          type: 'string',
          description: 'Name of the sub-agent to delegate to',
        },
        task: {
          type: 'string',
          description: 'Task description for the sub-agent',
        },
      },
      required: ['subagent', 'task'],
    },
    execute: async (args: Record<string, unknown>) => {
      const subagent = args.subagent as string;
      const task = args.task as string;

      try {
        const result = await delegation.delegate(subagent, task, []);
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return `Error delegating to ${subagent}: ${errorMsg}`;
      }
    },
  };
}

export function createListSubAgentsTool(): Tool {
  return {
    name: 'list_subagents',
    description: 'List all available sub-agents',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const subAgents = registry.list();

      if (subAgents.length === 0) {
        return 'No sub-agents available. Register sub-agents first.';
      }

      let result = 'Available sub-agents:\n\n';
      for (const sa of subAgents) {
        result += `- ${sa.name} (${sa.mode}): ${sa.description}\n`;
      }

      return result;
    },
  };
}
