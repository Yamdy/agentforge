import type { Agent, LLMAdapter, Plugin, ToolDef } from './types.js';
import { createAgentLoop } from './agent-loop.js';

export interface RuntimeConfig {
  llm: LLMAdapter;
}

export interface AgentConfig {
  tools?: string[];
  plugins?: Plugin[];
}

export class Runtime {
  private llm: LLMAdapter;
  private toolRegistry: Map<string, ToolDef>;
  private plugins: Plugin[];

  constructor(config: RuntimeConfig) {
    this.llm = config.llm;
    this.toolRegistry = new Map();
    this.plugins = [];
  }

  registerTool(name: string, tool: ToolDef): void {
    this.toolRegistry.set(name, tool);
  }

  use(plugin: Plugin): void {
    this.plugins.push(plugin);
  }

  agent(config: AgentConfig = {}): Agent {
    const { tools: toolNames = [], plugins: agentPlugins = [] } = config;

    const resolvedTools = new Map<string, ToolDef>();
    for (const name of toolNames) {
      const tool = this.toolRegistry.get(name);
      if (!tool) {
        throw new Error(`Tool "${name}" not found in registry`);
      }
      resolvedTools.set(name, tool);
    }

    const allPlugins = [...this.plugins, ...agentPlugins];

    return createAgentLoop(this.llm, resolvedTools, allPlugins);
  }
}
