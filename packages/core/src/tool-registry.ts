import { jsonSchema } from 'ai';
import type { Tool, ToolHook, ToolHookContext, ToolExecutionContext, ToolResult } from '@agentforge/sdk';

export interface AiSdkToolDef {
  description: string;
  inputSchema: unknown;
  execute?: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface AiSdkToolSchema {
  description: string;
  inputSchema: unknown;
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

  unregister(name: string): boolean {
    return this.tools.delete(name);
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

  /** Tool schemas for AI SDK without execute — model can request tools but SDK won't auto-execute. */
  toAiSdkToolSchemas(): Record<string, AiSdkToolSchema> {
    const result: Record<string, AiSdkToolSchema> = {};
    for (const tool of this.tools.values()) {
      const schema = isZodSchema(tool.inputSchema)
        ? tool.inputSchema
        : jsonSchema(tool.inputSchema as Record<string, unknown>);
      result[tool.name] = {
        description: tool.description,
        inputSchema: schema,
      };
    }
    return result;
  }

  /** Execute a single tool by name with full hook chain + validation. */
  async executeTool(name: string, args: Record<string, unknown>, context?: ToolExecutionContext & { toolCallId?: string }): Promise<ToolResult> {
    const tool = this.tools.get(name);
    const toolCallId = context?.toolCallId ?? '';
    if (!tool) {
      return { toolCallId, name, output: undefined, error: `Tool "${name}" not found` };
    }

    const execCtx = context ?? this.executionContext;
    const hookCtx: ToolHookContext = { toolName: tool.name, args };

    // Validate input against Zod schema
    if (isZodSchema(tool.inputSchema)) {
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error?.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') ?? parsed.error?.message ?? 'Unknown validation error';
        return { toolCallId, name: tool.name, output: undefined, error: `Input validation failed: ${issues}` };
      }
    }

    // Before hooks
    for (const hook of this.beforeHooks) {
      await hook(hookCtx);
    }

    let toolOutput: unknown;
    let toolError: string | undefined;
    try {
      toolOutput = await tool.execute(args, execCtx);
    } catch (err) {
      toolError = err instanceof Error ? err.message : String(err);
      hookCtx.error = err instanceof Error ? err : new Error(toolError);
      await this.runAfterHooks(hookCtx);
      return { toolCallId, name: tool.name, output: undefined, error: toolError };
    }

    // After hooks (success path)
    hookCtx.result = toolOutput;
    await this.runAfterHooks(hookCtx);

    // Wrap hook
    if (execCtx.pluginManager) {
      try {
        const wrapped = await execCtx.pluginManager.invokeWrapHook('tool.wrap', {
          toolName: tool.name,
          args,
          result: toolOutput,
          sessionId: execCtx.sessionId ?? '',
        });
        if (wrapped && typeof wrapped === 'object' && 'result' in wrapped) {
          toolOutput = (wrapped as Record<string, unknown>).result;
        }
      } catch {
        // Wrap hook failure must not break tool execution.
      }
    }

    // Truncation
    const output = this.truncateOutput(toolOutput);
    return { toolCallId, name: tool.name, output };
  }

  toAiSdkTools(): Record<string, AiSdkToolDef> {
    const result: Record<string, AiSdkToolDef> = {};
    for (const tool of this.tools.values()) {
      // MCP tools provide raw JSON Schema objects; Zod-based tools provide Zod schemas.
      // AI SDK requires either a Zod schema or a jsonSchema()-wrapped object.
      const schema = isZodSchema(tool.inputSchema)
        ? tool.inputSchema
        : jsonSchema(tool.inputSchema as Record<string, unknown>);

      result[tool.name] = {
        description: tool.description,
        inputSchema: schema,
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

          // Wrap hook (if invoker is wired in)
          if (this.executionContext.pluginManager) {
            try {
              const wrapped = await this.executionContext.pluginManager.invokeWrapHook('tool.wrap', {
                toolName: tool.name,
                args,
                result: toolResult,
                sessionId: this.executionContext.sessionId ?? '',
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
