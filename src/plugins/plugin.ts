/**
 * AgentForge Plugin System — Imperative Interfaces
 *
 * Plugin system using hooks for interception points:
 * - RequestHook: modify messages before LLM call
 * - ToolHook: check/block tool execution
 * - ToolProviderHook: per-call dynamic tool injection/filtering
 * - CheckpointHook: cross-cutting lifecycle checks that can block
 * - Event subscriptions: pure observation, non-blocking
 *
 * Design principles:
 * - Plugin errors are isolated — never crash the agent loop
 * - Hooks execute in priority order (lower = earlier)
 * - HookRegistry is the single point of registration
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import {
  type AgentEventType,
  type AgentEvent,
  type Message,
  AgentEventEmitter,
} from '../core/events.js';
import type {
  RequestHook,
  ToolHook,
  ToolProviderHook,
  CheckpointHook,
  RecoveryHookEntry,
} from '../core/hooks.js';
import type { AgentState } from '../core/state.js';
import type { Tracer, Metrics, ToolDefinition } from '../core/interfaces.js';

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
  /** Logger for diagnostic output */
  readonly logger?: import('../core/logger.js').Logger;
  /** Emit custom events through the agent's event emitter */
  readonly emitter: AgentEventEmitter;
  /** Get a read-only snapshot of the current agent state */
  getState(): Readonly<AgentState>;
  /** List registered tool definitions (read-only -- cannot execute) */
  listTools(): ToolDefinition[];
  /** Inject messages into the conversation flow */
  addMessages(messages: Message[]): void;
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
   */
  state?: Record<string, unknown>;

  /** Request hooks — modify messages before each LLM call */
  requestHooks?: RequestHook[];

  /** Tool hooks — check/block tool execution before it runs */
  toolHooks?: ToolHook[];

  /** ToolProvider hooks — per-call dynamic tool injection/filtering */
  toolProviderHooks?: ToolProviderHook[];

  /** Event subscriptions — pure observation, non-blocking */
  eventSubscriptions?: Array<{
    event: AgentEventType;
    handler: (event: AgentEvent) => void | Promise<void>;
  }>;

  /** Checkpoint hooks — cross-cutting lifecycle checks that can block the agent loop */
  checkpointHooks?: CheckpointHook[];

  /** Recovery hooks — observe error/recovery events (fire-and-forget, non-blocking) */
  recoveryHooks?: RecoveryHookEntry[];

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
// Plugin Context Factory
// ============================================================

export interface CreatePluginContextOptions {
  sessionId: string;
  agentName: string;
  tracer?: Tracer;
  metrics?: Metrics;
  logger?: import('../core/logger.js').Logger;
  emitter?: AgentEventEmitter;
  getState?: () => Readonly<AgentState>;
  listTools?: () => ToolDefinition[];
  addMessages?: (messages: Message[]) => void;
}

export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  const base = {
    sessionId: options.sessionId,
    agentName: options.agentName,
    emitter: options.emitter ?? new AgentEventEmitter(),
    getState:
      options.getState ??
      (() => {
        throw new Error('PluginContext.getState() is not available in this context');
      }),
    listTools: options.listTools ?? (() => []),
    addMessages: options.addMessages ?? (() => {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  };
  if (options.tracer !== undefined || options.metrics !== undefined) {
    return {
      ...base,
      ...(options.tracer !== undefined ? { tracer: options.tracer } : {}),
      ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
    };
  }
  return base;
}
