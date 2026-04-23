// ========== Tool Lifecycle Middleware Types ==========

import type { ToolContext } from '../tool/context';
import type { ToolResult } from '../tool/result';

/**
 * Context passed through the tool lifecycle middleware chain.
 *
 * Provides middleware with access to the tool being executed,
 * its arguments, the original ToolContext, and timing/retry metadata.
 */
export interface ToolLifecycleContext {
  /** Tool being executed */
  tool: {
    name: string;
    description: string;
  };

  /** Parsed arguments for the tool */
  args: Record<string, unknown>;

  /** Original ToolContext (abort, messages, ask, etc.) */
  ctx: ToolContext;

  /** Call start time in ms since epoch (set by manager) */
  startTime?: number;

  /** Retry attempt number, 0-based (set by retry middleware) */
  attempt?: number;
}

/**
 * Result produced by the middleware chain after tool execution.
 *
 * Carries the final ToolResult along with metadata about
 * whether execution was skipped, any errors, and custom metadata
 * collected by middleware.
 */
export interface ToolLifecycleResult {
  /** Final ToolResult (may be mutated by middleware) */
  result: ToolResult;

  /** Whether execution was skipped by a middleware */
  skipped?: boolean;

  /** Error if execution failed (still produces a result via errorResult) */
  error?: Error;

  /** Metadata collected by middleware during the chain */
  metadata?: Record<string, unknown>;
}

/**
 * Tool lifecycle middleware function signature (onion-style).
 *
 * Inspired by Agentscope's onion middleware pattern. Each middleware:
 * - Can modify `context.args` before calling `next()`
 * - Can modify `result` after `next()` returns
 * - Can skip execution by not calling `next()` and returning a result directly
 * - Can handle errors from `next()` via try/catch
 *
 * @example
 * ```typescript
 * const loggingMiddleware: ToolLifecycleMiddleware = async (context, next) => {
 *   console.log(`[before] ${context.tool.name}`)
 *   const result = await next()
 *   console.log(`[after] ${context.tool.name} - ${result.result.title}`)
 *   return result
 * }
 * ```
 */
export type ToolLifecycleMiddleware = (
  context: ToolLifecycleContext,
  next: () => Promise<ToolLifecycleResult>
) => Promise<ToolLifecycleResult>;

/**
 * Configuration for retry middleware.
 *
 * Implements exponential backoff with configurable delays,
 * capped at maxDelay. Inspired by LangChain's ToolRetryMiddleware.
 */
export interface RetryConfig {
  /** Maximum retry attempts (0 = no retry, default 0) */
  maxRetries: number;

  /** Initial delay in ms before first retry (default 1000) */
  initialDelay?: number;

  /** Backoff multiplier applied after each attempt (default 2) */
  backoffFactor?: number;

  /** Maximum delay cap in ms (default 30000) */
  maxDelay?: number;

  /**
   * Predicate to determine if an error is retryable.
   * Defaults to retrying on any error.
   */
  retryIf?: (error: Error) => boolean;
}

/**
 * Configuration for error handling middleware.
 */
export interface ErrorMiddlewareConfig {
  /** Include error stack trace in output (default false) */
  includeStack?: boolean;

  /**
   * Custom error transformer.
   * If provided, this function converts an Error into a ToolResult
   * instead of using the default errorResult.
   */
  transform?: (error: Error, ctx: ToolLifecycleContext) => ToolResult;
}

/**
 * Timing metadata added by timingMiddleware.
 */
export interface TimingMetadata {
  /** Execution start time in ms since epoch */
  startTime: number;

  /** Execution duration in ms */
  duration: number;
}

/**
 * Retry metadata added by retryMiddleware.
 */
export interface RetryMetadata {
  /** Number of retries attempted */
  retries: number;

  /** Total time spent retrying in ms */
  retryDuration: number;
}
