/**
 * AgentForge Plugin System — Imperative Interfaces
 *
 * Plugin system using hooks for interception points:
 * - RequestHook: modify messages before LLM call
 * - ToolHook: filter tool definitions + check/modify tool execution
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
  CheckpointHook,
  RecoveryHookEntry,
  LifecycleHookEntry,
  SystemPromptHook,
  LLMParamsHook,
  MessageHook,
  ToolExecuteHook,
} from '../core/hooks.js';
import type { AgentState } from '../core/state.js';
import type {
  Tracer,
  Metrics,
  ToolDefinition,
  LLMAdapter,
  MemoryStore,
} from '../core/interfaces.js';

// ============================================================
// Plugin Context (Restricted - prevents capability bypass)
// ============================================================

/**
 * Plugin context — capabilities available to plugins.
 *
 * Plugins can observe, participate, and extend agent behavior.
 * All capabilities are optional — a plugin that only observes events
 * doesn't need tool execution or LLM access.
 *
 * Inspired by Pi-Mono ExtensionAPI (11 capability groups).
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
  /** List registered tool definitions (read-only — cannot execute) */
  listTools(): ToolDefinition[];
  /** Inject messages into the conversation flow */
  addMessages(messages: Message[]): void;

  // ── Extended capabilities (Phase 2.1 — Pi-Mono parity) ──

  /** Execute a tool by name — lets plugins delegate work through the agent's tool pipeline */
  executeTool?(toolName: string, args: unknown): Promise<string>;
  /** Get the LLM adapter — lets plugins make independent LLM calls */
  getLLM?(): LLMAdapter;
  /** Dynamically register a new tool — lets plugins extend agent capabilities at runtime */
  registerTool?(tool: ToolDefinition): void;
  /** Modify agent state — lets plugins update runtime state (model, tokens, etc.) */
  setState?(patch: Partial<AgentState>): void;
  /** Get the memory store — lets plugins read/write persistent context */
  getMemory?(): MemoryStore | undefined;
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

  /** Tool hooks — filter tool definitions + check/modify tool execution */
  toolHooks?: ToolHook[];

  /** Event subscriptions — pure observation, non-blocking */
  eventSubscriptions?: Array<{
    event: AgentEventType;
    handler: (event: AgentEvent) => void | Promise<void>;
  }>;

  /** Checkpoint hooks — cross-cutting lifecycle checks that can block the agent loop */
  checkpointHooks?: CheckpointHook[];

  /** Recovery hooks — observe error/recovery events (fire-and-forget, non-blocking) */
  recoveryHooks?: RecoveryHookEntry[];

  /** Lifecycle hooks — observe lifecycle events (fire-and-forget, non-blocking) */
  lifecycleHooks?: LifecycleHookEntry[];

  /** System prompt hooks — transform the system prompt before LLM calls */
  systemPromptHooks?: SystemPromptHook[];

  /** LLM params hooks — modify LLM call parameters (temperature, maxTokens, etc.) */
  llmParamsHooks?: LLMParamsHook[];

  /** Message hooks — transform user messages before they enter the conversation */
  messageHooks?: MessageHook[];

  /** Tool execute hooks — wrap tool execution with before/after handlers */
  toolExecuteHooks?: ToolExecuteHook[];

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
  // Extended capabilities (optional — plugins that don't need them omit them)
  executeTool?: (toolName: string, args: unknown) => Promise<string>;
  getLLM?: () => LLMAdapter;
  registerTool?: (tool: ToolDefinition) => void;
  setState?: (patch: Partial<AgentState>) => void;
  getMemory?: () => MemoryStore | undefined;
}

export function createPluginContext(options: CreatePluginContextOptions): PluginContext {
  return {
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
    // Extended capabilities (optional)
    ...(options.executeTool !== undefined ? { executeTool: options.executeTool } : {}),
    ...(options.getLLM !== undefined ? { getLLM: options.getLLM } : {}),
    ...(options.registerTool !== undefined ? { registerTool: options.registerTool } : {}),
    ...(options.setState !== undefined ? { setState: options.setState } : {}),
    ...(options.getMemory !== undefined ? { getMemory: options.getMemory } : {}),
    // Observability
    ...(options.tracer !== undefined ? { tracer: options.tracer } : {}),
    ...(options.metrics !== undefined ? { metrics: options.metrics } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
  };
}
