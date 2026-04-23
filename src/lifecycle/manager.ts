// ========== Tool Lifecycle Manager ==========

import type { ToolContext } from '../tool/context';
import type { ToolResult } from '../tool/result';
import type {
  ToolLifecycleContext,
  ToolLifecycleMiddleware,
  ToolLifecycleResult,
} from './types';

/**
 * Manages the execution of tools through an onion-style middleware chain.
 *
 * Middlewares are registered via `use()` and executed in registration order
 * (first registered = outermost in the onion). The innermost handler calls
 * the actual tool executor.
 *
 * Inspired by Agentscope's onion middleware pattern and Koa's middleware composition.
 *
 * @example
 * ```typescript
 * const manager = new ToolLifecycleManager()
 *   .use(loggingMiddleware())
 *   .use(timingMiddleware())
 *   .use(retryMiddleware({ maxRetries: 2 }))
 *
 * const result = await manager.execute(tool, args, ctx, executor)
 * ```
 */
export class ToolLifecycleManager {
  private middlewares: ToolLifecycleMiddleware[] = [];

  /**
   * Register a middleware to be executed in the chain.
   * Middlewares are executed in registration order (first = outermost).
   *
   * @param middleware - The middleware function to register
   * @returns this (for chaining)
   */
  use(middleware: ToolLifecycleMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Register multiple middlewares at once.
   *
   * @param middlewares - Array of middleware functions to register
   * @returns this (for chaining)
   */
  useAll(middlewares: ToolLifecycleMiddleware[]): this {
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * Remove all registered middlewares.
   */
  clear(): void {
    this.middlewares = [];
  }

  /**
   * Get a read-only copy of registered middlewares.
   */
  getMiddlewares(): readonly ToolLifecycleMiddleware[] {
    return [...this.middlewares];
  }

  /**
   * Execute a tool through the middleware chain.
   *
   * Creates the initial lifecycle context, builds the onion middleware chain,
   * and executes it. The innermost handler calls the provided executor.
   *
   * @param tool - Tool metadata (name, description)
   * @param args - Parsed arguments for the tool
   * @param ctx - Original ToolContext
   * @param executor - Function that actually executes the tool
   * @returns The final ToolResult after all middleware processing
   */
  async execute(
    tool: { name: string; description: string },
    args: Record<string, unknown>,
    ctx: ToolContext,
    executor: (args: unknown, ctx: ToolContext) => Promise<ToolResult>
  ): Promise<ToolResult> {
    const context: ToolLifecycleContext = {
      tool,
      args,
      ctx,
      startTime: Date.now(),
      attempt: 0,
    };

    const result = await this.executeWithContext(context, () =>
      // Use context.args (may be modified by middleware) instead of original args
      executor(context.args, ctx)
    );

    // Merge lifecycle metadata into the ToolResult metadata
    if (result.metadata && result.result.metadata) {
      result.result.metadata = {
        ...result.result.metadata,
        _lifecycle: result.metadata,
      } as unknown;
    } else if (result.metadata) {
      result.result.metadata = { _lifecycle: result.metadata } as unknown;
    }

    return result.result;
  }

  /**
   * Execute through the middleware chain with an explicit context.
   *
   * This is the core execution method that builds and runs the onion chain.
   *
   * @param context - The lifecycle context for this execution
   * @param executor - Base handler that performs the actual tool execution
   * @returns The lifecycle result including metadata from middlewares
   */
  async executeWithContext(
    context: ToolLifecycleContext,
    executor: () => Promise<ToolResult>
  ): Promise<ToolLifecycleResult> {
    // Build the middleware chain using a contextual handler type
    type Handler = (ctx: ToolLifecycleContext) => Promise<ToolLifecycleResult>;

    // Innermost handler: calls the actual executor and wraps the result
    let current: Handler = async (_ctx: ToolLifecycleContext) => ({
      result: await executor(),
    });

    // Wrap middlewares in REVERSE order:
    // Last registered → innermost (closest to executor)
    // First registered → outermost (wraps everything)
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const middleware = this.middlewares[i];
      const next = current;

      current = (ctx: ToolLifecycleContext) =>
        middleware(ctx, () => next(ctx));
    }

    // Execute the chain with the provided context
    return current(context);
  }
}
