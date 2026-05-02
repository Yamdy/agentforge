/**
 * AgentForge Plugin System - New Imperative Interfaces
 *
 * Plugin system using hooks for interception points:
 * - RequestHook: modify messages before LLM call
 * - ToolHook: check/block tool execution
 * - LifecycleHook: (input, output) => Promise<void> at cut-points
 * - Event subscriptions: pure observation, non-blocking
 *
 * Design principles:
 * - Plugin errors are isolated — never crash the agent loop
 * - Hooks execute in priority order (lower = earlier)
 * - HookRegistry is the single point of registration
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import { z } from 'zod';
import type { AgentEventType, AgentEvent } from '../core/events.js';
import type { RequestHook, ToolHook, ToolProviderHook, HookFn, HookName } from '../core/hooks.js';
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
 * Plugin base interface.
 *
 * Plugins register hooks and/or event subscriptions.
 * They do NOT intercept event streams — they hook into cut-points.
 */
export interface Plugin {
  /** Unique plugin identifier */
  readonly name: string;

  /** Whether plugin is currently enabled */
  enabled: boolean;

  /**
   * Framework-managed cross-turn state.
   *
   * Persists for the session lifetime. Plugins can read/write this state
   * across hook invocations. The framework does NOT mutate this object —
   * plugins own their state entirely.
   *
   * Use cases:
   * - SandboxPlugin: track sandbox init status across turns
   * - PhasePlugin: remember current planning phase
   * - CounterPlugin: count tool invocations across turns
   */
  state?: Record<string, unknown>;

  /** Request hooks — modify messages before each LLM call */
  requestHooks?: RequestHook[];

  /** Tool hooks — check/block tool execution before it runs */
  toolHooks?: ToolHook[];

  /** ToolProvider hooks — per-call dynamic tool injection/filtering */
  toolProviderHooks?: ToolProviderHook[];

  /** Lifecycle hooks — observe lifecycle cut-points */
  lifecycleHooks?: Array<{ name: HookName; fn: HookFn; priority?: number }>;

  /** Event subscriptions — pure observation, non-blocking */
  eventSubscriptions?: Array<{
    event: AgentEventType;
    handler: (event: AgentEvent) => void | Promise<void>;
  }>;

  /**
   * @deprecated Legacy: use requestHooks instead. Plugin type discriminator for backward compat.
   */
  type?: 'interceptor' | 'observer';

  /**
   * @deprecated Legacy: use requestHooks instead. Intercept function for legacy interceptor plugins.
   */
  intercept?: (
    event: AgentEvent,
    ctx: PluginContext
  ) => AgentEvent | Promise<AgentEvent | undefined | null> | undefined | null;

  /**
   * @deprecated Legacy: use eventSubscriptions instead. Observe function for legacy observer plugins.
   */
  observe?: (event: AgentEvent, ctx: PluginContext) => void | Promise<void>;

  /**
   * @deprecated Legacy: use lifecycle hook priority instead.
   */
  priority?: number;

  /**
   * @deprecated Legacy: filter by event type via hook conditions instead.
   */
  eventTypes?: readonly string[];

  /**
   * Initialize plugin with restricted context.
   * Called once when plugin is registered.
   */
  init?(ctx: PluginContext): void | Promise<void>;

  /**
   * Cleanup resources.
   * Called when plugin is unregistered.
   */
  destroy?(): void;
}

// ============================================================
// Legacy Types (for backward compat during migration)
// ============================================================

/**
 * @deprecated Use Plugin interface directly. Interceptor pattern is replaced by RequestHook + ToolHook.
 */
export interface InterceptorPlugin extends Plugin {
  readonly type: 'interceptor';
  readonly priority: number;
  readonly eventTypes: readonly string[];
  intercept?: (
    event: AgentEvent,
    ctx: PluginContext
  ) => AgentEvent | Promise<AgentEvent | undefined | null> | undefined | null;
}

/**
 * @deprecated Use Plugin interface directly. Observer pattern is replaced by eventSubscriptions.
 */
export interface ObserverPlugin extends Plugin {
  readonly type: 'observer';
  readonly priority: number;
  readonly eventTypes: readonly string[];
  observe?: (event: AgentEvent, ctx: PluginContext) => void | Promise<void>;
}

// ============================================================
// Plugin Validation Schema (Tier 1 for third-party plugins)
// ============================================================

export const PluginSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['interceptor', 'observer']).optional(),
  priority: z.number().int().default(100),
  eventTypes: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

/**
 * Validate a third-party plugin definition
 */
export function validatePlugin(raw: unknown): z.infer<typeof PluginSchema> {
  return PluginSchema.parse(raw);
}

// ============================================================
// Type Guards (backward compat)
// ============================================================

/** @deprecated — all plugins now use lifecycle hooks, not intercept/observe */
export function isInterceptorPlugin(plugin: unknown): plugin is InterceptorPlugin {
  return (plugin as { type?: string }).type === 'interceptor';
}

/** @deprecated — all plugins now use lifecycle hooks, not intercept/observe */
export function isObserverPlugin(plugin: unknown): plugin is ObserverPlugin {
  return (plugin as { type?: string }).type === 'observer';
}

// ============================================================
// Plugin Context Factory
// ============================================================

export interface CreatePluginContextOptions {
  sessionId: string;
  agentName: string;
  tracer?: Tracer;
  metrics?: Metrics;
}

export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
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
