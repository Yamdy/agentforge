/**
 * AgentForge Logger Interface
 *
 * Structured logging interface for replacing console.* calls.
 * Provides leveled logging with context support.
 *
 * @module
 */

/**
 * Logger interface for structured logging
 *
 * All methods accept a message string and optional context.
 * The error method additionally accepts an Error object.
 */
export interface Logger {
  /** Debug-level message (verbose, development only) */
  debug(msg: string, context?: Record<string, unknown>): void;

  /** Info-level message (general operational information) */
  info(msg: string, context?: Record<string, unknown>): void;

  /** Warn-level message (potential issues, non-fatal) */
  warn(msg: string, context?: Record<string, unknown>): void;

  /** Error-level message (failures, exceptions) */
  error(msg: string, error?: Error, context?: Record<string, unknown>): void;
}

/**
 * Default console-based Logger implementation
 *
 * Prefixes all messages with `[prefix]` for identification.
 * Suitable for development and simple production use.
 *
 * @example
 * ```typescript
 * const logger = new DefaultLogger('agentforge');
 * logger.info('Agent started', { sessionId: 'abc123' });
 * // Output: [agentforge] Agent started { sessionId: 'abc123' }
 * ```
 */
export class DefaultLogger implements Logger {
  constructor(private prefix: string = 'agentforge') {}

  debug(msg: string, ctx?: Record<string, unknown>): void {
    console.debug(`[${this.prefix}] ${msg}`, ctx ?? '');
  }

  info(msg: string, ctx?: Record<string, unknown>): void {
    console.info(`[${this.prefix}] ${msg}`, ctx ?? '');
  }

  warn(msg: string, ctx?: Record<string, unknown>): void {
    console.warn(`[${this.prefix}] ${msg}`, ctx ?? '');
  }

  error(msg: string, error?: Error, ctx?: Record<string, unknown>): void {
    console.error(`[${this.prefix}] ${msg}`, error, ctx ?? '');
  }
}

/**
 * No-op logger that silently discards all messages
 *
 * Useful for testing or when logging should be completely disabled.
 */
export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
