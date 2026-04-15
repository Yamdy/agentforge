import type { Tool, Message } from '../types.js';
import { registry } from './registry.js';
import { delegation } from './delegation.js';
import { getCurrentMemory } from '../context.js';

export interface DelegateToSubAgentToolArgs {
  subagent: string;
  task: string;
  contextMessages?: Message[];
}

export function createDelegateToSubAgentTool(): Tool {
  return {
    name: 'delegate_to_subagent',
    description:
      'Delegate a task to a specialized sub-agent. The sub-agent will work independently and return the result.',
    parameters: {
      type: 'object',
      properties: {
        subagent: {
          type: 'string',
          description: 'Name of the sub-agent to delegate to',
        },
        task: {
          type: 'string',
          description: 'Detailed task description for the sub-agent',
        },
        includeContext: {
          type: 'boolean',
          description: 'Whether to include current conversation context (default: true)',
        },
      },
      required: ['subagent', 'task'],
    },
    execute: async (args: Record<string, unknown>) => {
      // Runtime validation
      if (typeof args.subagent !== 'string') {
        return 'Error: subagent must be a string';
      }
      if (typeof args.task !== 'string') {
        return 'Error: task must be a string';
      }
      const subagent = args.subagent;
      const task = args.task;
      const includeContext = typeof args.includeContext === 'boolean' ? args.includeContext : true;

      const context = getCurrentMemory();
      const parentMessages = includeContext && context?.messages ? [...context.messages] : [];

      try {
        const result = await delegation.delegate(subagent, task, parentMessages);
        return `Sub-agent ${subagent} result:\n\n${result}`;
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
    description: 'List all available sub-agents with their descriptions',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const subAgents = registry.list();

      if (subAgents.length === 0) {
        return 'No sub-agents available. Register sub-agents first using SubAgent.register().';
      }

      let result = 'Available sub-agents:\n\n';
      for (const sa of subAgents) {
        result += `- **${sa.name}** (${sa.mode}): ${sa.description}\n`;
      }

      return result;
    },
  };
}
