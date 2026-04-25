/**
 * AgentForge Custom RxJS Operators
 *
 * Specialized operators for agent event stream handling.
 *
 * @module
 */

import { Observable, defer } from 'rxjs';
import type { MonoTypeOperatorFunction, OperatorFunction } from 'rxjs';
import { filter, tap, map } from 'rxjs/operators';
import { type AgentEvent, isTerminalEvent } from '../core/index.js';

// ============================================================
// Type Guards
// ============================================================

/**
 * Filter events by type
 *
 * @example
 * source.pipe(filterEventType('llm.response'))
 */
export function filterEventType<T extends AgentEvent['type']>(
  eventType: T
): OperatorFunction<AgentEvent, Extract<AgentEvent, { type: T }>> {
  return filter((event): event is Extract<AgentEvent, { type: T }> => event.type === eventType);
}

/**
 * Filter events by type prefix
 *
 * @example
 * source.pipe(filterEventTypePrefix('llm.'))  // llm.request, llm.response, etc.
 */
export function filterEventTypePrefix(prefix: string): OperatorFunction<AgentEvent, AgentEvent> {
  return filter(event => event.type.startsWith(prefix));
}

// ============================================================
// Terminal Conditions
// ============================================================

/**
 * Complete the stream when a terminal event is emitted
 *
 * Terminal events: done, agent.error, cancel
 *
 * @example
 * source.pipe(takeUntilTerminal())
 */
export function takeUntilTerminal<T extends AgentEvent>(): MonoTypeOperatorFunction<T> {
  return source =>
    new Observable<T>(subscriber => {
      return source.subscribe({
        next(value) {
          subscriber.next(value);
          if (isTerminalEvent(value)) {
            subscriber.complete();
          }
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          subscriber.complete();
        },
      });
    });
}

/**
 * Create an observable that emits when a terminal event passes through the source
 */
export function onTerminal<T extends AgentEvent>(): MonoTypeOperatorFunction<T> {
  return source =>
    new Observable<T>(subscriber => {
      return source.subscribe({
        next(value) {
          subscriber.next(value);
          if (isTerminalEvent(value)) {
            subscriber.complete();
          }
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          subscriber.complete();
        },
      });
    });
}

// ============================================================
// Event Helpers
// ============================================================

/**
 * Tap into events with type narrowing
 *
 * @example
 * source.pipe(tapEvent('llm.response', event => {
 *   console.log('LLM responded:', event.content);
 * }))
 */
export function tapEvent<T extends AgentEvent['type']>(
  eventType: T,
  handler: (event: Extract<AgentEvent, { type: T }>) => void
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    if (event.type === eventType) {
      handler(event as Extract<AgentEvent, { type: T }>);
    }
  });
}

/**
 * Tap into multiple event types
 *
 * @example
 * source.pipe(tapEvents({
 *   'llm.response': e => console.log('Response:', e.content),
 *   'tool.result': e => console.log('Result:', e.result),
 * }))
 */
export function tapEvents(
  handlers: Partial<{
    [K in AgentEvent['type']]: (event: Extract<AgentEvent, { type: K }>) => void;
  }>
): MonoTypeOperatorFunction<AgentEvent> {
  return tap(event => {
    const handler = handlers[event.type];
    if (handler) {
      (handler as (e: AgentEvent) => void)(event);
    }
  });
}

// ============================================================
// Metrics & Collection
// ============================================================

export interface AgentMetrics {
  /** Total events emitted */
  totalEvents: number;
  /** LLM calls made */
  llmCalls: number;
  /** Tool executions */
  toolExecutions: number;
  /** Errors encountered */
  errors: number;
  /** Total tokens used */
  promptTokens: number;
  completionTokens: number;
  /** Duration in ms */
  durationMs: number;
}

/**
 * Collect metrics from agent event stream
 *
 * @param callback - Called on stream completion with metrics
 * @example
 * source.pipe(collectMetrics(metrics => console.log(metrics)))
 */
export function collectMetrics(
  callback: (metrics: AgentMetrics) => void
): MonoTypeOperatorFunction<AgentEvent> {
  // 🔴 P0 修复：用 defer 包裹确保每次订阅有独立 metrics 状态
  return source =>
    defer(() => {
      const startTime = Date.now();
      const metrics: AgentMetrics = {
        totalEvents: 0,
        llmCalls: 0,
        toolExecutions: 0,
        errors: 0,
        promptTokens: 0,
        completionTokens: 0,
        durationMs: 0,
      };

      return new Observable<AgentEvent>(subscriber => {
        return source.subscribe({
          next(event) {
            metrics.totalEvents++;

            switch (event.type) {
              case 'llm.request':
                metrics.llmCalls++;
                break;
              case 'llm.response':
                if (event.usage) {
                  metrics.promptTokens += event.usage.promptTokens;
                  metrics.completionTokens += event.usage.completionTokens;
                }
                break;
              case 'tool.execute':
                metrics.toolExecutions++;
                break;
              case 'agent.error':
                metrics.errors++;
                break;
            }

            subscriber.next(event);
          },
          error(err) {
            metrics.durationMs = Date.now() - startTime;
            callback(metrics);
            subscriber.error(err);
          },
          complete() {
            metrics.durationMs = Date.now() - startTime;
            callback(metrics);
            subscriber.complete();
          },
        });
      });
    });
}

// ============================================================
// Event Grouping
// ============================================================

/**
 * Group consecutive events by step number
 *
 * @example
 * source.pipe(groupByStep())
 */
export function groupByStep(): OperatorFunction<AgentEvent, AgentEvent[]> {
  // 🔴 P0 修复：用 defer 包裹确保每次订阅有独立 buffer
  return source =>
    defer(() => {
      let buffer: AgentEvent[] = [];

      return new Observable<AgentEvent[]>(subscriber => {
        return source.subscribe({
          next(event) {
            buffer.push(event);

            // Flush buffer on terminal events
            if (isTerminalEvent(event)) {
              if (buffer.length > 0) {
                subscriber.next([...buffer]);
                buffer = [];
              }
            }
          },
          error(err) {
            subscriber.error(err);
          },
          complete() {
            if (buffer.length > 0) {
              subscriber.next([...buffer]);
            }
            subscriber.complete();
          },
        });
      });
    });
}

// ============================================================
// Rate Limiting
// ============================================================

/**
 * Emit only the first event of each type within the window
 *
 * @example
 * source.pipe(dedupeEventTypes(100)) // 100ms window
 */
export function dedupeEventTypes(windowMs: number): MonoTypeOperatorFunction<AgentEvent> {
  // 🔴 P0 修复：用 defer 包裹确保每次订阅有独立 lastSeen Map
  return source =>
    defer(() => {
      const lastSeen = new Map<AgentEvent['type'], number>();

      return source.pipe(
        filter(event => {
          const now = Date.now();
          const last = lastSeen.get(event.type);

          if (last === undefined || now - last > windowMs) {
            lastSeen.set(event.type, now);
            return true;
          }

          return false;
        })
      );
    });
}

// ============================================================
// Transform Operators
// ============================================================

/**
 * Transform events to their string representation for logging
 *
 * @example
 * source.pipe(eventToString())
 * // "llm.response: Hello world"
 */
export function eventToString(): OperatorFunction<AgentEvent, string> {
  return map(event => {
    switch (event.type) {
      case 'agent.start':
        return `agent.start: ${event.input.slice(0, 50)}...`;
      case 'llm.response':
        return `llm.response: ${event.content.slice(0, 50)}...`;
      case 'tool.result':
        return `tool.result (${event.toolName}): ${event.result.slice(0, 50)}...`;
      case 'agent.error':
        return `agent.error: ${event.error.message}`;
      case 'done':
        return `done: ${event.reason}`;
      default:
        return event.type;
    }
  });
}

/**
 * Add timestamp to events for latency tracking
 *
 * @example
 * source.pipe(withLatency())
 */
export interface EventWithLatency {
  event: AgentEvent;
  receivedAt: number;
  latencyMs: number;
}

export function withLatency(
  getSentAt: (event: AgentEvent) => number | null
): OperatorFunction<AgentEvent, EventWithLatency> {
  return map(event => ({
    event,
    receivedAt: Date.now(),
    latencyMs: (getSentAt(event) ?? Date.now()) - Date.now(),
  }));
}

// ============================================================
// Transform Operators (from transform.ts)
// ============================================================

export {
  transformLLMParams,
  transformToolArgs,
  compressMessages,
  injectSystemPrompt,
  type LLMTransformParams,
} from './transform.js';

// ============================================================
// Notification Operators (from notify.ts)
// ============================================================

export {
  logEvents,
  traceEvents,
  recordMetrics,
  exportEvents,
  checkpoint,
  type Logger,
} from './notify.js';

// ============================================================
// Control Operators (from control.ts)
// ============================================================

export {
  retryOnEventType,
  timeoutOnEventType,
  requirePermission,
  maxStepsLimit,
  pauseOnSignal,
} from './control.js';

// ============================================================
// Operator Presets (from presets.ts)
// ============================================================

export {
  productionPreset,
  debugPreset,
  testPreset,
  createPreset,
  type ProductionPresetConfig,
  type DebugPresetConfig,
  type TestPresetConfig,
} from './presets.js';
