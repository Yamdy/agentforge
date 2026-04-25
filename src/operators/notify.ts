/**
 * AgentForge Notification Operators
 *
 * Side-effect operators for logging, tracing, metrics, and checkpoints.
 * All operators use `tap` and never block or throw on the main event stream.
 *
 * Design principles:
 * - Use `tap` for all side effects
 * - Async operations use fire-and-forget pattern
 * - Errors are silently swallowed to prevent stream interruption
 * - Never modify the event object
 *
 * @module
 */

import type { MonoTypeOperatorFunction } from 'rxjs';
import { tap } from 'rxjs/operators';
import { type AgentEvent, type CheckpointPosition } from '../core/index.js';
import type { Tracer, Metrics, CheckpointStorage } from '../core/interfaces.js';
import type { Checkpoint } from '../core/checkpoint.js';
import type { AgentState } from '../core/state.js';

// ============================================================
// Logger Interface
// ============================================================

/**
 * Logger interface for event logging
 */
export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * Default console logger implementation
 */
const defaultLogger: Logger = {
  debug: (message: string, data?: unknown) => console.debug(message, data),
  info: (message: string, data?: unknown) => console.info(message, data),
  warn: (message: string, data?: unknown) => console.warn(message, data),
  error: (message: string, data?: unknown) => console.error(message, data),
};

// ============================================================
// Event Logger
// ============================================================

/**
 * Log all events passing through the stream
 *
 * Uses `tap` to log events without blocking the stream.
 * Useful for debugging and development.
 *
 * @param logger - Logger instance (defaults to console)
 * @returns Operator that logs events
 *
 * @example
 * ```typescript
 * source.pipe(
 *   logEvents(),
 *   // or with custom logger
 *   logEvents(myWinstonLogger)
 * )
 * ```
 */
export function logEvents(
  logger: Logger = defaultLogger
): MonoTypeOperatorFunction<AgentEvent> {
  return tap((event: AgentEvent) => {
    logger.debug(`[${event.type}]`, event);
  });
}

// ============================================================
// Distributed Tracing
// ============================================================

/**
 * Trace events for distributed observability
 *
 * Uses `tap` to record trace events without blocking the stream.
 * Integrates with OpenTelemetry, Jaeger, or custom tracers.
 *
 * @param tracer - Tracer implementation
 * @returns Operator that traces events
 *
 * @example
 * ```typescript
 * source.pipe(
 *   traceEvents(myTracer)
 * )
 * ```
 */
export function traceEvents(
  tracer: Tracer
): MonoTypeOperatorFunction<AgentEvent> {
  return tap((event: AgentEvent) => {
    try {
      // Record event as a span event
      const spanName = `agent.event.${event.type}`;
      const spanId = tracer.startSpan(spanName, {
        attributes: {
          'event.type': event.type,
          'event.timestamp': event.timestamp,
        },
      });

      // End span immediately for now (could be extended for async spans)
      tracer.endSpan(spanId);

      // Add event details based on type
      tracer.addEvent(spanId, event.type, {
        eventType: event.type,
        timestamp: event.timestamp,
      });
    } catch {
      // Silently ignore tracing errors - never interrupt the stream
    }
  });
}

// ============================================================
// Metrics Collection
// ============================================================

/**
 * Record metrics from agent events
 *
 * Uses `tap` to collect metrics without blocking the stream.
 * Tracks event counts, token usage, and tool execution.
 *
 * Metrics recorded:
 * - `agent.event.{type}` - Counter for each event type
 * - `llm.tokens.prompt` - Histogram for prompt tokens (llm.response)
 * - `llm.tokens.completion` - Histogram for completion tokens (llm.response)
 * - `tool.execution.count` - Counter for tool executions
 *
 * @param metrics - Metrics implementation
 * @returns Operator that records metrics
 *
 * @example
 * ```typescript
 * source.pipe(
 *   recordMetrics(myMetricsCollector)
 * )
 * ```
 */
export function recordMetrics(
  metrics: Metrics
): MonoTypeOperatorFunction<AgentEvent> {
  return tap((event: AgentEvent) => {
    try {
      // Increment counter for every event type
      metrics.increment(`agent.event.${event.type}`);

      // Record token usage from LLM responses
      if (event.type === 'llm.response' && event.usage) {
        metrics.histogram('llm.tokens.prompt', event.usage.promptTokens);
        metrics.histogram('llm.tokens.completion', event.usage.completionTokens);
      }

      // Track tool executions
      if (event.type === 'tool.execute') {
        metrics.increment('tool.execution.count', 1, {
          toolName: event.toolName,
        });
      }

      // Track errors
      if (event.type === 'agent.error') {
        metrics.increment('agent.error.count', 1, {
          errorType: event.error.name ?? 'UnknownError',
        });
      }
    } catch {
      // Silently ignore metrics errors - never interrupt the stream
    }
  });
}

// ============================================================
// Remote Export
// ============================================================

/**
 * Export events to remote systems asynchronously
 *
 * Uses fire-and-forget pattern with `tap` - never blocks the stream.
 * Errors are caught and passed to the optional `onError` handler.
 *
 * @param exporter - Async function to export events
 * @param onError - Optional error handler (defaults to no-op)
 * @returns Operator that exports events
 *
 * @example
 * ```typescript
 * source.pipe(
 *   exportEvents(
 *     async (event) => await httpClient.send('/events', event),
 *     (err) => console.warn('Export failed:', err)
 *   )
 * )
 * ```
 */
export function exportEvents(
  exporter: (event: AgentEvent) => Promise<void>,
  onError: (error: Error) => void = () => {
    /* no-op */
  }
): MonoTypeOperatorFunction<AgentEvent> {
  return tap((event: AgentEvent) => {
    // Fire-and-forget: start async export but don't wait
    exporter(event).catch(onError);
  });
}

// ============================================================
// Checkpoint Storage
// ============================================================

/**
 * Determine checkpoint position based on event type
 * Maps event types to valid CheckpointPosition values
 */
function getCheckpointPosition(event: AgentEvent): CheckpointPosition {
  switch (event.type) {
    case 'llm.request':
      return 'before_llm';
    case 'llm.response':
      return 'after_llm';
    case 'tool.execute':
      return 'before_tool';
    case 'tool.result':
      return 'after_tool';
    default:
      // Default to after_llm for other events
      return 'after_llm';
  }
}

/**
 * Generate unique checkpoint ID
 */
function generateCheckpointId(): string {
  return `cp_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Save checkpoints to persistent storage.
 *
 * Uses fire-and-forget pattern with `tap` - never blocks the stream.
 * Only saves checkpoints when `shouldCheckpoint` returns true.
 * Errors are silently swallowed to prevent stream interruption.
 *
 * **Important**: The `stateProvider` parameter is required for meaningful
 * checkpoints that can be used for recovery. Without it, checkpoints will
 * contain placeholder state that cannot be used for actual agent resumption.
 *
 * @param storage - Checkpoint storage implementation
 * @param sessionId - Session identifier for checkpoint grouping
 * @param shouldCheckpoint - Predicate to determine when to save
 * @param stateProvider - Function that returns the current agent state.
 *                        This is needed to capture the actual state for recovery.
 *                        If not provided, a placeholder state will be saved.
 * @returns Operator that saves checkpoints
 *
 * @example
 * ```typescript
 * // With state provider (recommended for production)
 * source.pipe(
 *   checkpoint(
 *     myStorage,
 *     'session-123',
 *     (event) => event.type === 'llm.response',
 *     () => currentAgentState  // Capture state at checkpoint time
 *   )
 * )
 * ```
 *
 * @example
 * ```typescript
 * // Without state provider (placeholder only - not usable for recovery)
 * source.pipe(
 *   checkpoint(
 *     myStorage,
 *     'session-123',
 *     (event) => event.type === 'tool.result'
 *   )
 * )
 * ```
 */
export function checkpoint(
  storage: CheckpointStorage,
  sessionId: string,
  shouldCheckpoint: (event: AgentEvent) => boolean,
  stateProvider?: () => AgentState | undefined
): MonoTypeOperatorFunction<AgentEvent> {
  return tap((event: AgentEvent) => {
    if (shouldCheckpoint(event)) {
      // Get state from provider or create placeholder
      const state = stateProvider?.() ?? {
        sessionId: sessionId,
        agentName: 'agent',
        model: {
          provider: 'unknown',
          model: 'unknown',
        },
        messages: [],
        pendingToolCalls: [],
        step: 0,
        maxSteps: 10,
        output: '',
        tokens: {
          prompt: 0,
          completion: 0,
        },
      };

      // Fire-and-forget: start async save but don't wait
      const checkpointData: Checkpoint = {
        id: generateCheckpointId(),
        sessionId: sessionId,
        timestamp: event.timestamp,
        position: getCheckpointPosition(event),
        state: state,
        // Required fields with defaults from CheckpointSchema
        pendingA2A: [],
        executedTools: [],
        recoveryMetadata: {
          recoveryCount: 0,
        },
        compactionHistory: [],
      };

      storage.save(checkpointData).catch(() => {
        // Silently ignore checkpoint save errors - never interrupt the stream
      });
    }
  });
}
