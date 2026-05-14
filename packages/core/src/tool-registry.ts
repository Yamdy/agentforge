import { jsonSchema } from 'ai';
import type { Tool, ToolExecutionContext, ToolResult } from '@agentforge/sdk';
import type { HookManager } from './hook-manager.js';
import type { EventBus } from './event-bus.js';

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
  private executionContext: ToolExecutionContext = {};
  private hookManager?: HookManager;
  private eventBus?: EventBus;

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

  setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  setToolExecutionContext(context: ToolExecutionContext): void {
    this.executionContext = context;
  }

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

  async executeTool(name: string, args: Record<string, unknown>, context?: ToolExecutionContext & { toolCallId?: string }): Promise<ToolResult> {
    const tool = this.tools.get(name);
    const toolCallId = context?.toolCallId ?? '';
    if (!tool) {
      return { toolCallId, name, output: undefined, error: `Tool "${name}" not found` };
    }

    const execCtx = context ?? this.executionContext;

    if (isZodSchema(tool.inputSchema)) {
      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        const issues = parsed.error?.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') ?? parsed.error?.message ?? 'Unknown validation error';
        return { toolCallId, name: tool.name, output: undefined, error: `Input validation failed: ${issues}` };
      }
    }

    const hookInput = { toolName: tool.name, args, sessionId: execCtx.sessionId ?? '' };

    if (this.hookManager) {
      await this.hookManager.invoke('tool.before', hookInput, {});
    }

    let toolOutput: unknown;
    let toolError: string | undefined;
    try {
      toolOutput = await tool.execute(args, execCtx);
    } catch (err) {
      toolError = err instanceof Error ? err.message : String(err);
      if (this.hookManager) {
        await this.hookManager.invoke('tool.after', hookInput, { error: toolError });
      }
      return { toolCallId, name: tool.name, output: undefined, error: toolError };
    }

    if (this.hookManager) {
      const hookOutput: Record<string, unknown> = { result: toolOutput };
      await this.hookManager.invoke('tool.after', hookInput, hookOutput);
      if (hookOutput.result !== undefined && hookOutput.result !== toolOutput) {
        this.eventBus?.emit('tool:output_mutated', { toolName: tool.name, original: toolOutput, mutated: hookOutput.result });
        toolOutput = hookOutput.result;
      }
    }

    const output = this.truncateOutput(toolOutput);
    return { toolCallId, name: tool.name, output };
  }

  private truncateOutput(output: unknown): unknown {
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
