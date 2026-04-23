import { Tool, LegacyTool, validateTool, isNewTool, isLegacyTool } from './types';
import type { ToolContext } from './tool/context';
import type { ToolResult } from './tool/result';
import type { PermissionManager } from './permission/manager';
import { errorResult } from './tool/result';

type AnyTool = Tool | LegacyTool;

export class ToolRegistry {
  private tools: Map<string, AnyTool> = new Map();
  private _permissionManager?: PermissionManager;

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
   * Set the permission manager for this registry.
   * When set, tool execution will be checked against permission rules.
   */
  setPermissionManager(manager: PermissionManager): void {
    this._permissionManager = manager;
  }

  /**
   * Get the current permission manager.
   */
  get permissionManager(): PermissionManager | undefined {
    return this._permissionManager;
  }

  /**
   * Execute a tool with full context support.
   * Supports both new Tool interface and legacy interface.
   * If a PermissionManager is set, checks permissions before execution.
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

    // Permission check (only for new tools with permission category)
    if (this._permissionManager && isNewTool(tool) && tool.permission) {
      const permResult = await this.checkPermission(tool, args, ctx);
      if (!permResult) {
        // Permission denied - errorResult already returned
        return errorResult(`Permission denied for tool: ${name}`);
      }
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
   * Check permission for a tool execution.
   * Returns true if allowed, false if denied.
   * Handles user interaction via ctx.ask() for 'ask' actions.
   */
  private async checkPermission(
    tool: Tool,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<boolean> {
    if (!this._permissionManager || !tool.permission) return true;

    const category = tool.permission.category;
    const input = tool.permission.extractInput(args);

    const result = this._permissionManager.check(
      ctx.sessionId,
      category,
      input,
      ctx.agent
    );

    switch (result.action) {
      case 'allow':
        return true;

      case 'deny':
        return false;

      case 'ask': {
        // Prompt user for approval
        if (!result.askPrompt) return false;

        const answer = await ctx.ask(result.askPrompt);

        if (answer.choice === 'Deny') {
          return false;
        }

        // Handle "always allow"
        if (answer.always || answer.choice === 'Always allow') {
          // Get suggested patterns from the check result
          const suggestedPatterns = result.suggestedPatterns ?? ['*'];
          for (const pattern of suggestedPatterns) {
            this._permissionManager.setAlwaysAllowed(ctx.sessionId, category, pattern);
          }
        }

        return true;
      }

      default:
        return false;
    }
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
