/**
 * AgentForge Hook System
 *
 * Inspired by OpenCode's (input, output) => Promise<void> pattern.
 * Provides cut-points for plugins to intercept and modify agent behavior
 * without event-stream interception.
 *
 * Three hook categories:
 * - LifecycleHook: (input, output) => Promise<void> — observe lifecycle events
 * - RequestHook: modify LLM messages before each call
 * - ToolHook: check/block tool execution before it runs
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import type { Message, ToolCall } from './events.js';
import type { AgentLoopState } from './state.js';

// ============================================================================
// Hook Name Enumeration
// ============================================================================

/**
 * All lifecycle hook names.
 *
 * These are cut-points where plugins can register callbacks.
 * The hook is called with (input, output) where:
 * - input: context data at the cut-point
 * - output: result data (may be empty {} if hook fires before result is available)
 */
export const HookName = {
  // ── Session lifecycle ──
  'session.start': 'session.start',
  'session.end': 'session.end',

  // ── Step lifecycle ──
  'step.begin': 'step.begin',
  'step.end': 'step.end',

  // ── LLM lifecycle ──
  'llm.request.before': 'llm.request.before',
  'llm.response.after': 'llm.response.after',
  'llm.error': 'llm.error',

  // ── Tool lifecycle ──
  'tool.execute.before': 'tool.execute.before',
  'tool.execute.after': 'tool.execute.after',
  'tool.execute.error': 'tool.execute.error',

  // ── Compaction lifecycle ──
  'compaction.before': 'compaction.before',
  'compaction.after': 'compaction.after',

  // ── Recovery lifecycle ──
  'recovery.escalate': 'recovery.escalate',
  'recovery.compact': 'recovery.compact',
  'recovery.fallback': 'recovery.fallback',
} as const;

export type HookName = (typeof HookName)[keyof typeof HookName];

// ============================================================================
// Hook Function Types
// ============================================================================

/**
 * Generic lifecycle hook function.
 *
 * @param input  - Context data at the cut-point (what triggered the hook)
 * @param output - Result data (empty {} for "before" hooks, result for "after" hooks)
 *
 * Errors thrown in hooks are silently caught by the loop — they never
 * crash the agent. This is intentional: plugin isolation is safety-critical.
 */
export type HookFn<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  output: TOutput
) => void | Promise<void>;

/**
 * Registered lifecycle hook entry.
 */
export interface LifecycleHookEntry {
  name: HookName;
  fn: HookFn;
  /** Lower number = earlier execution */
  priority: number;
}

// ============================================================================
// Request Hook (modify messages before LLM call)
// ============================================================================

/**
 * Request Hook — transforms the message list before each LLM call.
 *
 * Use cases:
 * - MemoryPlugin: inject memory context into messages
 * - SkillsPlugin: inject skill instructions into system prompt
 * - SummarizationPlugin: compact conversation history
 *
 * Hooks are applied in priority order (lower = earlier).
 * Each hook receives the output of the previous hook.
 */
export interface RequestHook {
  /** Unique hook name for debugging */
  name: string;
  /** Execution order (lower = earlier) */
  priority: number;
  /**
   * Apply the hook to the current message list.
   *
   * @param messages - Current messages (after previous hooks)
   * @param state    - Current agent loop state (read-only reference)
   * @returns Modified message list
   */
  apply(messages: Message[], state: AgentLoopState): Message[] | Promise<Message[]>;
}

// ============================================================================
// Tool Hook (check/block tool execution)
// ============================================================================

/**
 * Tool Hook — validates or blocks tool execution before it runs.
 *
 * Use cases:
 * - PermissionPlugin: deny dangerous tool calls
 * - RateLimitPlugin: throttle tool invocation frequency
 * - AuditPlugin: log all tool calls before execution
 *
 * Hooks are run in priority order. If ANY hook returns false,
 * the tool is blocked and subsequent hooks are NOT run.
 */
export interface ToolHook {
  /** Unique hook name for debugging */
  name: string;
  /** Execution order (lower = earlier) */
  priority: number;
  /**
   * Validate whether a tool call should proceed.
   *
   * @param toolCall - The tool call being requested
   * @param state    - Current agent loop state
   * @returns true to allow, false to block
   */
  beforeExecute(toolCall: ToolCall, state: AgentLoopState): boolean | Promise<boolean>;
}

// ============================================================================
// Hook Registry
// ============================================================================

/**
 * Hook Registry — central store for all registered hooks.
 *
 * Plugins register their hooks here. The agent loop queries hooks
 * at each cut-point and executes them in priority order.
 *
 * All hook execution errors are silently caught — no plugin crash
 * can kill the agent loop.
 */
export class HookRegistry {
  /**
   * Lifecycle hooks indexed by hook name.
   * Multiple plugins can register for the same hook name.
   */
  private lifecycle = new Map<HookName, LifecycleHookEntry[]>();

  /**
   * Request hooks (modify messages), sorted by priority.
   */
  private requests: RequestHook[] = [];

  /**
   * Tool hooks (check/block execution), sorted by priority.
   */
  private tools: ToolHook[] = [];

  // ── Lifecycle Hooks ──

  /**
   * Register a lifecycle hook.
   *
   * @param name     - Cut-point name
   * @param fn       - Hook function
   * @param priority - Execution order (default 50)
   * @returns Unregister function
   */
  on(name: HookName, fn: HookFn, priority = 50): () => void {
    const entry: LifecycleHookEntry = { name, fn, priority };
    const existing = this.lifecycle.get(name) ?? [];
    existing.push(entry);
    existing.sort((a, b) => a.priority - b.priority);
    this.lifecycle.set(name, existing);
    return () => {
      const arr = this.lifecycle.get(name);
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /**
   * Register multiple lifecycle hooks at once.
   */
  registerLifecycle(hooks: Array<{ name: HookName; fn: HookFn; priority?: number }>): () => void {
    const unregisters = hooks.map((h) => this.on(h.name, h.fn, h.priority));
    return () => unregisters.forEach((u) => u());
  }

  /**
   * Get all lifecycle hooks for a given name, sorted by priority.
   */
  getLifecycleHooks(name: HookName): HookFn[] {
    return (this.lifecycle.get(name) ?? []).map((e) => e.fn);
  }

  // ── Request Hooks ──

  /**
   * Register a request hook.
   *
   * @returns Unregister function
   */
  registerRequest(hook: RequestHook): () => void {
    this.requests.push(hook);
    this.requests.sort((a, b) => a.priority - b.priority);
    return () => {
      const idx = this.requests.indexOf(hook);
      if (idx >= 0) this.requests.splice(idx, 1);
    };
  }

  /**
   * Get all request hooks, sorted by priority.
   */
  getRequestHooks(): RequestHook[] {
    return this.requests;
  }

  // ── Tool Hooks ──

  /**
   * Register a tool hook.
   *
   * @returns Unregister function
   */
  registerTool(hook: ToolHook): () => void {
    this.tools.push(hook);
    this.tools.sort((a, b) => a.priority - b.priority);
    return () => {
      const idx = this.tools.indexOf(hook);
      if (idx >= 0) this.tools.splice(idx, 1);
    };
  }

  /**
   * Get all tool hooks, sorted by priority.
   */
  getToolHooks(): ToolHook[] {
    return this.tools;
  }

  // ── Bulk Operations ──

  /**
   * Remove all hooks (for cleanup/destroy).
   */
  clear(): void {
    this.lifecycle.clear();
    this.requests = [];
    this.tools = [];
  }
}
