/**
 * AgentForge Operator Presets
 *
 * Pre-configured combinations of operators for common use cases.
 * Each preset returns an OperatorFunction that can be piped into an event stream.
 *
 * @module
 */

import type { MonoTypeOperatorFunction } from 'rxjs';
import { tap } from 'rxjs/operators';
import { type AgentEvent } from '../core/index.js';
import type { Tracer, Metrics, CheckpointStorage } from '../core/interfaces.js';

// Import existing operators
import {
  retryOnEventType,
  timeoutOnEventType,
} from './control.js';
import {
  traceEvents,
  recordMetrics,
  checkpoint,
  type Logger,
} from './notify.js';

// ============================================================
// Production Preset
// ============================================================

/**
 * Configuration for production preset
 */
export interface ProductionPresetConfig {
  /** Timeout duration in milliseconds (default: 60000 = 1 minute) */
  timeout?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Distributed tracer for observability */
  tracer: Tracer;
  /** Metrics collector for observability */
  metrics: Metrics;
  /** Checkpoint storage for persistence */
  checkpointStorage: CheckpointStorage;
  /** Session ID for checkpoint grouping */
  sessionId: string;
  /** Event types to checkpoint on (default: llm.response, tool.result) */
  checkpointEvents?: AgentEvent['type'][];
  /** Event type to watch for timeout (default: llm.response) */
  timeoutEventType?: AgentEvent['type'];
  /** Event type to retry on (default: llm.error) */
  retryEventType?: AgentEvent['type'];
}

/**
 * Production-ready operator preset for agent event streams.
 *
 * Combines timeout, retry, tracing, metrics, and checkpointing for
 * production deployments. All side effects are non-blocking.
 *
 * Included operators:
 * - `timeoutOnEventType`: Times out if target event not received
 * - `retryOnEventType`: Retries on specific error events
 * - `traceEvents`: Records distributed traces
 * - `recordMetrics`: Collects metrics (event counts, tokens, etc.)
 * - `checkpoint`: Saves state at configurable points
 *
 * @param config - Configuration options
 * @returns Combined operator for production use
 *
 * @example
 * ```typescript
 * import { productionPreset } from './operators/presets.js';
 *
 * const agent$ = runAgent(context).pipe(
 *   productionPreset({
 *     tracer: myTracer,
 *     metrics: myMetrics,
 *     checkpointStorage: myStorage,
 *     sessionId: 'session-123',
 *   })
 * );
 * ```
 */
export function productionPreset(
  config: ProductionPresetConfig
): MonoTypeOperatorFunction<AgentEvent> {
  const {
    timeout = 60000,
    maxRetries = 3,
    retryDelay = 1000,
    tracer,
    metrics,
    checkpointStorage,
    sessionId,
    checkpointEvents = ['llm.response', 'tool.result'],
    timeoutEventType = 'llm.response',
    retryEventType = 'llm.error',
  } = config;

  return source =>
    source.pipe(
      // Timeout protection
      timeoutOnEventType(timeoutEventType, timeout),
      // Retry on recoverable errors
      retryOnEventType(retryEventType, maxRetries, retryDelay),
      // Distributed tracing
      traceEvents(tracer),
      // Metrics collection
      recordMetrics(metrics),
      // Checkpoint at key events
      checkpoint(
        checkpointStorage,
        sessionId,
        event => checkpointEvents.includes(event.type)
      )
    );
}

// ============================================================
// Debug Preset
// ============================================================

/**
 * Configuration for debug preset
 */
export interface DebugPresetConfig {
  /** Logger instance (defaults to console) */
  logger?: Logger;
  /** Whether to log all events or only key events (default: all) */
  logAllEvents?: boolean;
  /** Event types to always log (default: agent.error, done) */
  alwaysLogTypes?: AgentEvent['type'][];
}

/**
 * Debug operator preset for agent event streams.
 *
 * Combines comprehensive logging for development and debugging.
 * All events are logged with their full details.
 *
 * Included operators:
 * - `logEvents`: Logs all events passing through
 * - Error logging: Logs errors with stack traces
 * - Completion logging: Logs when stream completes
 *
 * @param configOrLogger - Logger instance or config object
 * @returns Combined operator for debugging
 *
 * @example
 * ```typescript
 * import { debugPreset } from './operators/presets.js';
 *
 * // Simple usage with default logger
 * const agent$ = runAgent(context).pipe(debugPreset());
 *
 * // With custom logger
 * const agent$ = runAgent(context).pipe(
 *   debugPreset(myWinstonLogger)
 * );
 *
 * // With config
 * const agent$ = runAgent(context).pipe(
 *   debugPreset({
 *     logger: myLogger,
 *     logAllEvents: true,
 *   })
 * );
 * ```
 */
export function debugPreset(
  configOrLogger?: Logger | DebugPresetConfig
): MonoTypeOperatorFunction<AgentEvent> {
  // Normalize config
  let logger: Logger;
  let logAllEvents = true;
  const alwaysLogTypes: AgentEvent['type'][] = ['agent.error', 'done'];

  if (configOrLogger === undefined) {
    // Default to console logger
    logger = {
      debug: (msg, data) => console.debug(msg, data),
      info: (msg, data) => console.info(msg, data),
      warn: (msg, data) => console.warn(msg, data),
      error: (msg, data) => console.error(msg, data),
    };
  } else if ('debug' in configOrLogger && typeof configOrLogger.debug === 'function') {
    // It's a Logger instance
    logger = configOrLogger;
  } else {
    // It's a config object
    const config = configOrLogger as DebugPresetConfig;
    logger = config.logger ?? {
      debug: (msg, data) => console.debug(msg, data),
      info: (msg, data) => console.info(msg, data),
      warn: (msg, data) => console.warn(msg, data),
      error: (msg, data) => console.error(msg, data),
    };
    logAllEvents = config.logAllEvents ?? true;
    if (config.alwaysLogTypes) {
      alwaysLogTypes.push(...config.alwaysLogTypes);
    }
  }

  return source =>
    source.pipe(
      // Log events based on config
      tap(event => {
        if (logAllEvents || alwaysLogTypes.includes(event.type)) {
          logger.debug(`[${event.type}]`, event);
        }
      }),
      // Log errors
      tap({
        error: err => {
          logger.error('[agent.error]', err);
        },
        complete: () => {
          logger.info('[stream.complete]', 'Agent stream completed');
        },
      })
    );
}

// ============================================================
// Test Preset
// ============================================================

/**
 * Configuration for test preset
 */
export interface TestPresetConfig {
  /** Callback for collecting events (default: no-op) */
  onEvent?: (event: AgentEvent) => void;
  /** Callback when terminal event is received */
  onTerminal?: (event: AgentEvent) => void;
  /** Whether to log events to console (default: false) */
  verbose?: boolean;
  /** Event types to log when verbose (default: all key events) */
  verboseTypes?: AgentEvent['type'][];
}

/**
 * Test operator preset for agent event streams.
 *
 * Simplified preset for testing environments. Logs key events only
 * and provides hooks for test assertions.
 *
 * Included operators:
 * - Event collection hook for test assertions
 * - Minimal logging of key events (start, error, complete, done)
 * - Terminal event detection
 *
 * @param config - Configuration options
 * @returns Combined operator for testing
 *
 * @example
 * ```typescript
 * import { testPreset } from './operators/presets.js';
 *
 * const collectedEvents: AgentEvent[] = [];
 *
 * const agent$ = runAgent(context).pipe(
 *   testPreset({
 *     onEvent: event => collectedEvents.push(event),
 *     onTerminal: event => console.log('Terminal:', event.type),
 *   })
 * );
 *
 * await firstValueFrom(agent$.pipe(toArray()));
 * expect(collectedEvents.length).toBeGreaterThan(0);
 * ```
 */
export function testPreset(
  config: TestPresetConfig = {}
): MonoTypeOperatorFunction<AgentEvent> {
  const {
    onEvent,
    onTerminal,
    verbose = false,
    verboseTypes = ['agent.start', 'agent.error', 'done', 'cancel'],
  } = config;

  // Terminal event types
  const terminalTypes: AgentEvent['type'][] = ['done', 'agent.error', 'cancel'];

  return source =>
    source.pipe(
      tap(event => {
        // Collect event via callback
        onEvent?.(event);

        // Log if verbose and matching type
        if (verbose && verboseTypes.includes(event.type)) {
          console.debug(`[test] [${event.type}]`, event);
        }

        // Notify on terminal events
        if (terminalTypes.includes(event.type)) {
          onTerminal?.(event);
        }
      })
    );
}

// ============================================================
// Utility: Create Custom Preset
// ============================================================

/**
 * Create a custom preset by combining multiple operators.
 *
 * This is a helper for creating reusable operator combinations
 * with sensible defaults.
 *
 * @param operators - Array of operators to combine
 * @returns Combined operator
 *
 * @example
 * ```typescript
 * import { createPreset, logEvents, recordMetrics } from './operators/index.js';
 *
 * const myPreset = createPreset([
 *   logEvents(myLogger),
 *   recordMetrics(myMetrics),
 * ]);
 *
 * const agent$ = runAgent(context).pipe(myPreset);
 * ```
 */
export function createPreset(
  operators: MonoTypeOperatorFunction<AgentEvent>[]
): MonoTypeOperatorFunction<AgentEvent> {
  return source => {
    // Apply operators in sequence
    let result = source;
    for (const op of operators) {
      result = result.pipe(op);
    }
    return result;
  };
}
