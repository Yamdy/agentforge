import type { Agent } from '../agent/index.js';
import type { Tool } from '../types.js';
import type { SubAgentRegistration, SubAgentConfig } from './types.js';

class SubAgentRegistry {
  private subAgents: Map<string, SubAgentRegistration> = new Map();

  register(config: SubAgentRegistration): void {
    this.subAgents.set(config.name, config);
  }

  list(): SubAgentConfig[] {
    return Array.from(this.subAgents.values()).map((sa) => ({
      name: sa.name,
      description: sa.description,
      mode: sa.mode,
    }));
  }

  get(name: string): SubAgentRegistration | undefined {
    return this.subAgents.get(name);
  }

  getAgent(name: string): Agent | undefined {
    return this.subAgents.get(name)?.agent;
  }

  getTools(name: string): Tool[] | undefined {
    return this.subAgents.get(name)?.tools;
  }
}

export const registry = new SubAgentRegistry();
