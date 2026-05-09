import type { Tool, ToolHook, ToolHookContext, ToolExecutionContext } from '@agentforge/sdk';

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
  private beforeHooks: ToolHook[] = [];
  private afterHooks: ToolHook[] = [];
  private executionContext: ToolExecutionContext = {};

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

  addBeforeHook(hook: ToolHook): void {
    this.beforeHooks.push(hook);
  }

  addAfterHook(hook: ToolHook): void {
    this.afterHooks.push(hook);
  }

  setToolExecutionContext(context: ToolExecutionContext): void {
    this.executionContext = context;
  }

  toAiSdkTools(): Record<string, AiSdkToolDef> {
    const result: Record<string, AiSdkToolDef> = {};
    for (const tool of this.tools.values()) {
      result[tool.name] = {
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args) => {
          const hookCtx: ToolHookContext = { toolName: tool.name, args };

          // Validate input against Zod schema
          if (
            tool.inputSchema &&
            typeof tool.inputSchema === 'object' &&
            'safeParse' in tool.inputSchema
          ) {
            const parsed = (tool.inputSchema as { safeParse: (args: unknown) => { success: boolean; error?: { issues?: Array<{ path: (string | number)[]; message: string }>; message?: string } } }).safeParse(args);
            if (!parsed.success) {
              const issues =
                parsed.error?.issues
                  ?.map((i) => `${i.path.join('.')}: ${i.message}`)
                  .join('; ') ??
                parsed.error?.message ??
                'Unknown validation error';
              throw new Error(
                `Tool "${tool.name}" input validation failed: ${issues}`,
              );
            }
          }

          // Before hooks
          for (const hook of this.beforeHooks) {
            await hook(hookCtx);
          }

          let toolResult: unknown;
          try {
            toolResult = await tool.execute(args, this.executionContext);
          } catch (err) {
            hookCtx.error = err instanceof Error ? err : new Error(String(err));
            throw err;
          }

          // After hooks
          hookCtx.result = toolResult;
          for (const hook of this.afterHooks) {
            await hook(hookCtx);
          }

          // Truncation
          return this.truncateOutput(toolResult);
        },
      };
    }
    return result;
  }

  private truncateOutput(output: unknown): unknown {
    if (typeof output === 'string' && output.length > this.maxOutputLength) {
      return output.slice(0, this.maxOutputLength) + '... [truncated]';
    }
    if (
      typeof output !== 'string' &&
      output !== null &&
      output !== undefined
    ) {
      const serialized = JSON.stringify(output);
      if (serialized.length > this.maxOutputLength) {
        return (
          serialized.slice(0, this.maxOutputLength) + '... [truncated]'
        );
      }
    }
    return output;
  }
}
