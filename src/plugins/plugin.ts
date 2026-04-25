/**
 * AgentForge Plugin System - Core Interfaces
 *
 * Design principles:
 * - Hook = Horizontal slice enhancement (operators), DI = Vertical capability replacement (interface implementations)
 * - Interceptors use concatMap (block main flow), Observers use tap (non-blocking)
 * - PluginContext is restricted - no llm/tools/memory access
 *
 * @see docs/architecture/RXJS-EVENT-STREAM-DESIGN/07-PLUGIN-SYSTEM.md
 */

import { z } from 'zod';
import { Observable } from 'rxjs';
import type { AgentEventType, AgentEvent } from '../core/events.js';
import type { Tracer, Metrics } from '../core/interfaces.js';

// ============================================================
// Plugin Context (Restricted - prevents capability bypass)
// ============================================================

/**
 * Plugin context - restricted access to prevent bypassing DI
 *
 * IMPORTANT: This context intentionally does NOT provide:
 * - llm: LLMAdapter - plugins should not call LLM directly
 * - tools: ToolRegistry - plugins should not execute tools directly
 * - memory: MemoryStore - plugins should not read/write memory directly
 * - checkpoint: CheckpointStorage - plugins should not manipulate checkpoints
 *
 * These capabilities should be injected via DI (vertical replacement),
 * not accessed via plugins (horizontal slice).
 */
export interface PluginContext {
  /** Read-only session identifier */
  readonly sessionId: string;

  /** Read-only agent name */
  readonly agentName: string;

  /** Distributed tracer for observability */
  readonly tracer?: Tracer;

  /** Metrics collector for observability */
  readonly metrics?: Metrics;
}

// ============================================================
// Plugin Base Interface
// ============================================================

/**
 * Plugin base interface
 *
 * All plugins share common metadata and lifecycle hooks.
 * Use PluginSchema for third-party plugin validation.
 */
export interface Plugin {
  /** Unique plugin identifier */
  readonly name: string;

  /** Plugin type - determines execution pattern */
  readonly type: 'interceptor' | 'observer';

  /**
   * Execution priority (lower = earlier)
   * Interceptors execute before observers
   * Default: 100
   */
  readonly priority: number;

  /**
   * Event types to subscribe to
   * Empty array = all events
   */
  readonly eventTypes: readonly AgentEventType[];

  /** Whether plugin is currently enabled */
  enabled: boolean;

  /**
   * Initialize plugin with restricted context
   * Called once when plugin is registered
   */
  init?(ctx: PluginContext): void | Promise<void>;

  /**
   * Cleanup resources
   * Called when plugin is unregistered
   */
  destroy?(): void;
}

// ============================================================
// Interceptor Plugin (Blocking, can modify events)
// ============================================================

/**
 * Interceptor plugin - blocks main flow, can modify events
 *
 * Execution: Uses concatMap - each interceptor must complete
 * before the next one starts.
 *
 * Capabilities:
 * - Modify events (return new event)
 * - Block flow (return EMPTY)
 * - Replace with different event (return different type)
 *
 * Use cases:
 * - Permission checks
 * - Rate limiting
 * - Memory loading
 * - HITL decisions
 */
export interface InterceptorPlugin extends Plugin {
  readonly type: 'interceptor';

  /**
   * Intercept an event
   *
   * @param event - The current event
   * @param ctx - Restricted plugin context
   * @returns Observable emitting zero or more events
   *
   * Return patterns:
   * - of(event) - pass through unchanged
   * - of(newEvent) - replace with new event
   * - of(event1, event2) - emit multiple events
   * - EMPTY - block the event (terminate this branch)
   */
  intercept(event: AgentEvent, ctx: PluginContext): Observable<AgentEvent>;
}

// ============================================================
// Observer Plugin (Non-blocking, read-only)
// ============================================================

/**
 * Observer plugin - non-blocking, read-only side effects
 *
 * Execution: Uses tap - never blocks main flow
 * Errors are caught and logged, never propagated.
 *
 * Use cases:
 * - Logging
 * - Metrics collection
 * - Auditing
 * - Webhook notifications
 */
export interface ObserverPlugin extends Plugin {
  readonly type: 'observer';

  /**
   * Observe an event (read-only)
   *
   * @param event - The current event (read-only)
   * @param ctx - Restricted plugin context
   * @returns void or Promise<void> (result ignored)
   *
   * Notes:
   * - Return value is ignored
   * - Exceptions are caught and logged
   * - Never blocks main flow
   * - If async, fire-and-forget pattern
   */
  observe(event: AgentEvent, ctx: PluginContext): void | Promise<void>;
}

// ============================================================
// Plugin Validation Schema (Tier 1 for third-party plugins)
// ============================================================

/**
 * Zod schema for validating third-party plugins
 *
 * Use this to validate plugins from external sources
 * before registration.
 */
export const PluginSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['interceptor', 'observer']),
  priority: z.number().int().default(100),
  eventTypes: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

/**
 * Validate a third-party plugin definition
 *
 * @param raw - Unknown plugin object
 * @returns Validated partial plugin
 * @throws ZodError if validation fails
 */
export function validatePlugin(raw: unknown): z.infer<typeof PluginSchema> {
  return PluginSchema.parse(raw);
}

// ============================================================
// Type Guards
// ============================================================

/**
 * Check if plugin is an interceptor
 */
export function isInterceptorPlugin(plugin: Plugin): plugin is InterceptorPlugin {
  return plugin.type === 'interceptor';
}

/**
 * Check if plugin is an observer
 */
export function isObserverPlugin(plugin: Plugin): plugin is ObserverPlugin {
  return plugin.type === 'observer';
}

// ============================================================
// Plugin Context Factory
// ============================================================

/**
 * Options for creating a plugin context
 */
export interface CreatePluginContextOptions {
  sessionId: string;
  agentName: string;
  tracer?: Tracer;
  metrics?: Metrics;
}

/**
 * Create a restricted plugin context
 *
 * @param options - Context options
 * @returns Frozen plugin context
 */
export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  // Build context with conditional properties to satisfy exactOptionalPropertyTypes
  return options.tracer !== undefined || options.metrics !== undefined
    ? {
        sessionId: options.sessionId,
        agentName: options.agentName,
        ...(options.tracer !== undefined ? { tracer: options.tracer } : {}),
        ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
      }
    : {
        sessionId: options.sessionId,
        agentName: options.agentName,
      };
}
