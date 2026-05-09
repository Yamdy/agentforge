import type { Tool } from '@agentforge/sdk';

export interface AiSdkToolDef {
  description: string;
  inputSchema: unknown;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolRegistryOptions {
  maxOutputLength?: number;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private maxOutputLength: number;

  constructor(options: ToolRegistryOptions = {}) {
    this.maxOutputLength = options.maxOutputLength ?? Infinity;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  toAiSdkTools(): Record<string, AiSdkToolDef> {
    const result: Record<string, AiSdkToolDef> = {};
    for (const tool of this.tools.values()) {
      result[tool.name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args) => {
          const result = await tool.execute(args, {});
          if (typeof result === 'string' && result.length > this.maxOutputLength) {
            return result.slice(0, this.maxOutputLength) + '... [truncated]';
          }
          return result;
        },
      };
    }
    return result;
  }
}
