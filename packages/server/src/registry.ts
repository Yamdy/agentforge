import { Agent, type AgentDependencies } from '@primo-ai/core';
import type { AgentConfig } from '@primo-ai/sdk';

export interface AgentEntry {
  id: string;
  agent: Agent;
  config: AgentConfig;
}

export class AgentRegistry {
  private agents = new Map<string, AgentEntry>();
  private sessionAgentMap = new Map<string, string>();

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
    this.sessionAgentMap.clear();
  }

  /** Map a sessionId to an agentId for reverse lookup. */
  registerSession(sessionId: string, agentId: string): void {
    this.sessionAgentMap.set(sessionId, agentId);
  }

  /** Look up the agent associated with a session. */
  getAgentBySession(sessionId: string): Agent | undefined {
    const agentId = this.sessionAgentMap.get(sessionId);
    if (!agentId) return undefined;
    return this.agents.get(agentId)?.agent;
  }

  /** Remove a session→agent mapping. */
  unregisterSession(sessionId: string): void {
    this.sessionAgentMap.delete(sessionId);
  }
}
