import { Agent, type AgentDependencies } from '@primo-ai/core';
import type { AgentConfig } from '@primo-ai/sdk';

export interface AgentEntry {
  id: string;
  agent: Agent;
  config: AgentConfig;
}

export class AgentRegistry {
  private agents = new Map<string, AgentEntry>();

  register(id: string, config: AgentConfig, deps?: AgentDependencies): Agent {
    const agent = new Agent(config, deps);
    this.agents.set(id, { id, agent, config });
    return agent;
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id)?.agent;
  }

  list(): Array<{ id: string; state: string }> {
    return Array.from(this.agents.values()).map(({ id, agent }) => ({
      id,
      state: agent.state,
    }));
  }

  remove(id: string): void {
    this.agents.delete(id);
  }

  clear(): void {
    this.agents.clear();
  }
}
