import type { Tool, ToolHook, ToolHookContext, ToolExecutionContext } from '@agentforge/sdk';

export interface AiSdkToolDef {
  description: string;
  inputSchema: unknown;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolRegistryOptions {
  maxOutputLength?: number;
}

interface SafeParseResult {
  success: boolean;
  error?: { issues?: Array<{ path: (string | number)[]; message: string }>; message?: string };
}

function isZodSchema(value: unknown): value is { safeParse: (args: unknown) => SafeParseResult } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'safeParse' in value &&
    typeof (value as Record<string, unknown>).safeParse === 'function'
  );
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
          if (isZodSchema(tool.inputSchema)) {
            const parsed = tool.inputSchema.safeParse(args);
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
            await this.runAfterHooks(hookCtx);
            throw err;
          }

          // After hooks (success path)
          hookCtx.result = toolResult;
          await this.runAfterHooks(hookCtx);

          // Wrap hook (if PluginManager is wired in)
          const wrapCtx = this.executionContext;
          if (wrapCtx?.pluginManager) {
            try {
              const pm = wrapCtx.pluginManager as {
                invokeWrapHook: (point: string, data: unknown) => Promise<unknown>;
              };
              const wrapped = await pm.invokeWrapHook('tool.wrap', {
                toolName: tool.name,
                args,
                result: toolResult,
                sessionId: wrapCtx.sessionId ?? '',
              });
              if (wrapped && typeof wrapped === 'object' && 'result' in wrapped) {
                toolResult = (wrapped as Record<string, unknown>).result;
              }
            } catch {
              // Wrap hook failure must not break tool execution.
              // Fall through with original toolResult.
            }
          }

          // Truncation
          return this.truncateOutput(toolResult);
        },
      };
    }
    return result;
  }

  private async runAfterHooks(hookCtx: ToolHookContext): Promise<void> {
    for (const hook of this.afterHooks) {
      await hook(hookCtx);
    }
  }

  private truncateOutput(output: unknown): unknown {
    // Skip truncation if already evicted (preview + reference metadata)
    if (output && typeof output === 'object' && 'evicted' in output) {
      return output;
    }
    if (typeof output === 'string' && output.length > this.maxOutputLength) {
      return output.slice(0, this.maxOutputLength) + '... [truncated]';
    }
    if (
      typeof output !== 'string' &&
      output !== null &&
      output !== undefined
    ) {
      try {
        const serialized = JSON.stringify(output);
        if (serialized.length > this.maxOutputLength) {
          return { truncated: true, preview: serialized.slice(0, this.maxOutputLength) };
        }
      } catch {
        return { truncated: true, preview: String(output).slice(0, this.maxOutputLength) };
      }
    }
    return output;
  }
}
