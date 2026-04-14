import { Tool, validateTool } from './types';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool | Tool[]): void {
    if (Array.isArray(tool)) {
      tool.forEach((t) => {
        const validated = validateTool(t);
        this.tools.set(validated.name, validated);
      });
    } else {
      const validated = validateTool(tool);
      this.tools.set(validated.name, validated);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    const result = String(await tool.execute(args));
    return result;
  }
}
