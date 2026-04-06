import type { Tool } from '../types.js';
import { client } from './client.js';

interface ToolGroup {
  name: string;
  tools: Map<string, Tool>;
  active: boolean;
}

class McpToolkit {
  private groups: Map<string, ToolGroup> = new Map();
  private basicGroupServers: Set<string> = new Set();

  constructor() {
    this.groups.set('basic', {
      name: 'basic',
      tools: new Map(),
      active: true,
    });
  }

  async refreshTools(): Promise<void> {
    const allTools = await client.tools();

    const basicGroup = this.groups.get('basic')!;
    basicGroup.tools.clear();

    for (const [name, tool] of Object.entries(allTools)) {
      const serverName = name.split('_')[0];
      if (this.basicGroupServers.size === 0 || this.basicGroupServers.has(serverName)) {
        basicGroup.tools.set(name, tool);
      }
    }
  }

  registerGroup(name: string, tools: Tool[]): void {
    const toolMap = new Map<string, Tool>();
    for (const tool of tools) {
      toolMap.set(tool.name, tool);
    }
    this.groups.set(name, {
      name,
      tools: toolMap,
      active: true,
    });
  }

  activateGroup(name: string): void {
    const group = this.groups.get(name);
    if (group) {
      group.active = true;
    }
  }

  deactivateGroup(name: string): void {
    const group = this.groups.get(name);
    if (group && name !== 'basic') {
      group.active = false;
    }
  }

  addToBasic(serverName: string): void {
    this.basicGroupServers.add(serverName);
  }

  removeFromBasic(serverName: string): void {
    this.basicGroupServers.delete(serverName);
  }

  getTools(groups?: string[]): Tool[] {
    const targetGroups = groups || ['basic'];
    const result: Tool[] = [];

    for (const groupName of targetGroups) {
      const group = this.groups.get(groupName);
      if (group && group.active) {
        result.push(...group.tools.values());
      }
    }

    return result;
  }
}

export const Toolkit = new McpToolkit();
