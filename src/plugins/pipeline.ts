/**
 * AgentForge Plugin Pipeline Builder
 *
 * Constructs RxJS pipeline from registered plugins.
 * Interceptors use concatMap (blocking), observers use tap (non-blocking).
 *
 * Execution order:
 * 1. Interceptors first (by priority ascending)
 * 2. Observers after (by priority ascending)
 *
 * Exception isolation: Single plugin error never breaks main flow.
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/07-PLUGIN-SYSTEM.md
 */

import { Observable, of, EMPTY } from 'rxjs';
import type { MonoTypeOperatorFunction } from 'rxjs';
import { concatMap, tap, catchError } from 'rxjs/operators';
import type { AgentEvent } from '../core/events.js';
import type {
  Plugin,
  InterceptorPlugin,
  ObserverPlugin,
  PluginContext,
} from './plugin.js';
import { isInterceptorPlugin, isObserverPlugin } from './plugin.js';

// ============================================================
// Pipeline Builder
// ============================================================

/**
 * Build a plugin pipeline from registered plugins
 *
 * @param source - Source observable of agent events
 * @param plugins - Array of plugins to apply
 * @param ctx - Restricted plugin context
 * @returns Observable with plugin pipeline applied
 *
 * Pipeline structure:
 * ```
 * source
 *   └── [Interceptor P=10] concatMap
 *         └── [Interceptor P=20] concatMap
 *               └── [Observer P=10] tap
 *                     └── [Observer P=20] tap
 *                           └── output
 * ```
 *
 * Exception handling:
 * - Interceptor error: Log + pass through original event (degrade gracefully)
 * - Observer error: Log only (never block main flow)
 */
export function buildPluginPipeline(
  source: Observable<AgentEvent>,
  plugins: readonly Plugin[],
  ctx: PluginContext
): Observable<AgentEvent> {
  // Separate and sort plugins
  const interceptors = plugins
    .filter(isInterceptorPlugin)
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  const observers = plugins
    .filter(isObserverPlugin)
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  // Start with source
  let pipeline = source;

  // Apply interceptors (concatMap - blocking, serial)
  for (const interceptor of interceptors) {
    pipeline = pipeline.pipe(
      applyInterceptor(interceptor, ctx)
    );
  }

  // Apply observers (tap - non-blocking, parallel)
  for (const observer of observers) {
    pipeline = pipeline.pipe(
      applyObserver(observer, ctx)
    );
  }

  return pipeline;
}

// ============================================================
// Interceptor Application
// ============================================================

/**
 * Create an operator that applies a single interceptor
 *
 * Uses concatMap to ensure serial execution.
 * Events not matching interceptor.eventTypes pass through unchanged.
 */
function applyInterceptor(
  interceptor: InterceptorPlugin,
  ctx: PluginContext
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    source.pipe(
      concatMap(event => {
        // Event type filtering
        if (interceptor.eventTypes.length > 0) {
          if (!interceptor.eventTypes.includes(event.type)) {
            return of(event); // Pass through unmatched events
          }
        }

        // Execute interceptor with exception isolation
        return interceptor.intercept(event, ctx).pipe(
          catchError(err => {
            // Log error
            ctx.tracer?.recordException('plugin-error', err as Error);
            ctx.metrics?.increment('plugin.error', 1, { plugin: interceptor.name });

            // Degrade: pass through original event
            return of(event);
          })
        );
      })
    );
}

// ============================================================
// Observer Application
// ============================================================

/**
 * Create an operator that applies a single observer
 *
 * Uses tap for side effects. Never blocks main flow.
 * Async observers use fire-and-forget pattern.
 */
function applyObserver(
  observer: ObserverPlugin,
  ctx: PluginContext
): MonoTypeOperatorFunction<AgentEvent> {
  return source =>
    source.pipe(
      tap(event => {
        // Event type filtering
        if (observer.eventTypes.length > 0) {
          if (!observer.eventTypes.includes(event.type)) {
            return; // Skip unmatched events
          }
        }

        // Execute observer with exception isolation
        try {
          const result = observer.observe(event, ctx);

          // Handle async observer (fire-and-forget)
          if (result instanceof Promise) {
            result.catch(err => {
              // Log async error but don't block
              ctx.tracer?.recordException('plugin-error', err as Error);
              ctx.metrics?.increment('plugin.error', 1, { plugin: observer.name });
            });
          }
        } catch (err) {
          // Synchronous error: log but never throw
          ctx.tracer?.recordException('plugin-error', err as Error);
          ctx.metrics?.increment('plugin.error', 1, { plugin: observer.name });
        }
      })
    );
}

// ============================================================
// Pipeline Utilities
// ============================================================

/**
 * Create an empty pipeline (passthrough)
 *
 * Useful for testing or when no plugins are registered.
 */
export function emptyPipeline(source: Observable<AgentEvent>): Observable<AgentEvent> {
  return source;
}

/**
 * Create a blocking pipeline that emits nothing
 *
 * Useful for plugins that want to terminate the flow.
 */
export function blockingPipeline(_source: Observable<AgentEvent>): Observable<AgentEvent> {
  return EMPTY;
}

/**
 * Create a pipeline that replaces all events with a single event
 *
 * Useful for plugins that want to redirect flow.
 */
export function replacePipeline(
  _source: Observable<AgentEvent>,
  replacement: AgentEvent
): Observable<AgentEvent> {
  return of(replacement);
}
