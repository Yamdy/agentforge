import { Tool, LegacyTool, validateTool, isNewTool, isLegacyTool } from './types';
import type { ToolContext } from './tool/context';
import type { ToolResult } from './tool/result';

type AnyTool = Tool | LegacyTool;

export class ToolRegistry {
  private tools: Map<string, AnyTool> = new Map();

  register(tool: AnyTool | AnyTool[]): void {
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

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  list(): AnyTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool with full context support.
   * Supports both new Tool interface and legacy interface.
   *
   * @param name - Tool name
   * @param args - Tool arguments
   * @param ctx - Execution context
   * @returns ToolResult with structured output
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Handle new Tool interface
    if (isNewTool(tool)) {
      // Zod validation if schema provided
      const parsedArgs = tool.parameters?.parse(args) ?? args;
      return tool.execute(parsedArgs, ctx);
    }

    // Handle legacy Tool interface (no context)
    if (isLegacyTool(tool)) {
      const output = await tool.execute(args);
      // Wrap legacy string result in ToolResult
      return {
        title: output.slice(0, 50),
        output,
      };
    }

    throw new Error(`Invalid tool: ${name}`);
  }

  /**
   * Execute a tool without context (legacy mode).
   * @deprecated Use execute(name, args, ctx) for full context support.
   */
  async executeLegacy(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    if (isLegacyTool(tool)) {
      const result = await tool.execute(args);
      return result ?? '';
    }

    if (isNewTool(tool)) {
      // Create mock context for backward compatibility
      const mockCtx: ToolContext = {
        sessionId: 'legacy',
        messageId: 'legacy',
        callId: 'legacy',
        agent: 'unknown',
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: async () => ({ choice: 'yes' }),
      };
      const parsedArgs = tool.parameters?.parse(args) ?? args;
      let result: ToolResult;
      try {
        result = await tool.execute(parsedArgs, mockCtx);
      } catch {
        result = { title: 'Error', output: 'Execution failed' };
      }
      return result.output;
    }

    throw new Error(`Invalid tool: ${name}`);
  }
}
