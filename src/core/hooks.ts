/**
 * AgentForge Hook System
 *
 * Inspired by OpenCode's (input, output) => Promise<void> pattern.
 * Provides cut-points for plugins to intercept and modify agent behavior
 * without event-stream interception.
 *
 * Hook categories:
 * - LifecycleHook: (input, output) => Promise<void> — observe lifecycle events
 * - RecoveryHook: (input, output) => Promise<void> — observe error/recovery events
 * - RequestHook: modify LLM messages before each call
 * - CheckpointHook: block/continue at checkpoint phases
 * - ToolHook: filter tool definitions + check/modify tool execution (unified in Task 4)
 *
 * @see docs/design/24-ARCH-REFACTOR.md
 */

import type { Message, ToolCall } from './events.js';
import type { AgentState } from './state.js';
import type { FunctionDefinition } from './interfaces.js';

// ============================================================================
// RequestHook Priority Convention (Progressive Disclosure)
// ============================================================================

/**
 * Standard priority tiers for RequestHook ordering.
 *
 * Three-tier progressive disclosure: context is layered into the LLM
 * request from foundational memory to applied skill knowledge.
 * Lower-numbered hooks execute first, establishing a foundation that
 * later hooks can build upon.
 *
 * Usage:
 * ```typescript
 * const hook: RequestHook = {
 *   name: 'my-memory-hook',
 *   priority: RequestHookPriority.MEMORY,
 *   apply(messages, state) { ... }
 * };
 * ```
 */
export const RequestHookPriority = {
  /** Memory context — persistent memory and AGENTS.md (lowest = runs first) */
  MEMORY: 10,

  /** Working memory — pinned items and scratchpad (survives compaction) */
  WORKING_MEMORY: 20,

  /** Skill instructions — domain knowledge and tool descriptions */
  SKILL: 30,
} as const;

export type RequestHookPriority = (typeof RequestHookPriority)[keyof typeof RequestHookPriority];

/** Default priority for hooks registered without explicit priority */
export const DEFAULT_REQUEST_HOOK_PRIORITY = 100;

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
  phase: LifecyclePhase;
  fn: HookFn;
  /** Lower number = earlier execution */
  priority: number;
}

/**
 * Registered recovery hook entry.
 */
export interface RecoveryHookEntry {
  phase: RecoveryPhase;
  fn: HookFn;
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
 *
 * @see RequestHookPriority for standard priority conventions
 */
export interface RequestHook {
  /** Unique hook name for debugging */
  name: string;
  /**
   * Execution order (lower = earlier).
   * Use {@link RequestHookPriority} constants for standard tiers.
   */
  priority: number;
  /**
   * Apply the hook to the current message list.
   *
   * @param messages - Current messages (after previous hooks)
   * @param state    - Current agent loop state (read-only reference)
   * @returns Modified message list
   */
  apply(messages: Message[], state: AgentState): Message[] | Promise<Message[]>;
}

// ============================================================================
// Tool Hook (filter definitions + check/modify before execution)
// ============================================================================

/** Result of a beforeExecute check. */
export type ToolBeforeResult =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'modify'; args: Record<string, unknown> };

/**
 * Tool Hook — unified interface for tool control.
 *
 * Combines the former ToolProviderHook (filtering tool definitions before
 * LLM calls) and ToolHook (checking/modifying tool execution) into a single
 * interface. A ToolHook can implement either or both methods.
 *
 * Use cases:
 * - filter: remove dangerous tools, inject context-specific tools
 * - beforeExecute: permission check, rate-limit, parameter modification
 *
 * Hooks are run in priority order (lower = earlier).
 * - filter: each hook transforms the array, next hook sees the result
 * - beforeExecute: first block/modify wins, remaining hooks skip
 */
export interface ToolHook {
  /** Unique hook name for debugging */
  name: string;
  /** Execution order (lower = earlier) */
  priority: number;

  /**
   * Optional — filter/inject tool definitions before each LLM call.
   *
   * @param tools - Current tool definitions (after previous hooks)
   * @param state - Current agent loop state (read-only reference)
   * @returns Modified tool definitions
   */
  filter?(
    tools: FunctionDefinition[],
    state: AgentState
  ): FunctionDefinition[] | Promise<FunctionDefinition[]>;

  /**
   * Optional — validate or modify a tool call before execution.
   *
   * @param toolCall - The tool call being requested
   * @param state    - Current agent loop state
   * @returns allow, block with reason, or modify with new args
   */
  beforeExecute?(
    toolCall: ToolCall,
    state: AgentState
  ): ToolBeforeResult | Promise<ToolBeforeResult>;
}

// ============================================================================
// Checkpoint Hook (cross-cutting lifecycle checks — quota, rate-limit, quality)
// ============================================================================

// ============================================================================
// Lifecycle Phase Types (Three Semantically Distinct Categories)
// ============================================================================

/**
 * Checkpoint Phase — blocking hooks that can terminate the agent loop.
 *
 * Used exclusively by CheckpointHook. A hook registered for a CheckpointPhase
 * can return { action: 'block' } to stop the loop.
 *
 * checkpoints run at these two cut-points:
 * - pre-llm: before each LLM call (quota, rate-limit)
 * - post-llm: after each LLM response (quality gate, circuit breaker)
 */
export type CheckpointPhase = 'pre-llm' | 'post-llm';

/**
 * Lifecycle Phase — observational fire-and-forget hooks.
 *
 * Used by LifecycleHookEntry. These hooks observe lifecycle events but
 * CANNOT block the loop. Errors are silently caught.
 */
export type LifecyclePhase =
  | 'session.start'
  | 'session.end'
  | 'step.begin'
  | 'step.end'
  | 'llm.request.before'
  | 'llm.response.after'
  | 'tool.before'
  | 'tool.after'
  | 'compaction.before'
  | 'compaction.after';

/**
 * Recovery Phase — error and recovery lifecycle hooks.
 *
 * Used by RecoveryHookEntry. Triggered when errors occur or recovery
 * actions are taken (escalation, compaction-based recovery, fallback).
 */
export type RecoveryPhase =
  | 'llm.error'
  | 'tool.error'
  | 'recovery.escalate'
  | 'recovery.compact'
  | 'recovery.fallback'
  | 'error';

/**
 * Result of a checkpoint execution.
 *
 * - continue: Proceed normally.
 * - block: Stop the current phase. The agent loop terminates with the given reason.
 */
export type CheckpointResult = { action: 'continue' } | { action: 'block'; reason: string };

/** Known checkpoint block reasons produced by built-in plugins. */
export const CheckpointBlockReason = {
  /** Token/cost quota exceeded (QuotaPlugin) */
  QUOTA_EXCEEDED: 'quota_exceeded',
  /** Quality gate rejected output, retry with correction injected (QualityGatePlugin) */
  QUALITY_GATE_RETRY: 'quality_gate_retry',
} as const;
export type CheckpointBlockReason =
  (typeof CheckpointBlockReason)[keyof typeof CheckpointBlockReason];

/**
 * Checkpoint function signature.
 *
 * Uses `unknown` for ctx/state parameters to avoid circular dependencies
 * (hooks.ts is a low-level module). Types are narrowed at call sites.
 *
 * MUST NOT throw — errors should be handled internally.
 */
export type CheckpointFn = (
  ctx: unknown,
  state: unknown,
  ...args: unknown[]
) => CheckpointResult | Promise<CheckpointResult>;

/**
 * Checkpoint Hook — registered by plugins to run at lifecycle phases.
 *
 * Unlike lifecycle hooks (fire-and-forget observation), checkpoint hooks
 * can BLOCK the agent loop. This replaces the standalone CheckpointRegistry.
 *
 * Hooks are run in priority order (lower = earlier). Execution stops at the
 * first `{ action: 'block' }` result.
 */
export interface CheckpointHook {
  /** Unique hook name for debugging */
  name: string;
  /** Checkpoint phase when this checkpoint executes */
  phase: CheckpointPhase;
  /** Execution order (lower = earlier) */
  priority: number;
  /** Check function — returns 'continue' or 'block' */
  check: CheckpointFn;
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
  private lifecycle = new Map<LifecyclePhase, LifecycleHookEntry[]>();

  /**
   * Request hooks (modify messages), sorted by priority.
   */
  private requests: RequestHook[] = [];

  /**
   * Tool hooks (check/block execution), sorted by priority.
   */
  private tools: ToolHook[] = [];

  /**
   * Recovery hooks indexed by phase.
   */
  private recovery = new Map<RecoveryPhase, RecoveryHookEntry[]>();

  // ── Lifecycle Hooks ──

  /**
   * Register a lifecycle hook.
   *
   * @param name     - Cut-point name
   * @param fn       - Hook function
   * @param priority - Execution order (default: DEFAULT_REQUEST_HOOK_PRIORITY = 100)
   * @returns Unregister function
   */
  on(phase: LifecyclePhase, fn: HookFn, priority = DEFAULT_REQUEST_HOOK_PRIORITY): () => void {
    const entry: LifecycleHookEntry = { phase, fn, priority };
    const existing = this.lifecycle.get(phase) ?? [];
    existing.push(entry);
    existing.sort((a, b) => a.priority - b.priority);
    this.lifecycle.set(phase, existing);
    return () => {
      const arr = this.lifecycle.get(phase);
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /**
   * Register multiple lifecycle hooks at once.
   */
  registerLifecycle(
    hooks: Array<{ phase: LifecyclePhase; fn: HookFn; priority?: number }>
  ): () => void {
    const unregisters = hooks.map(h => this.on(h.phase, h.fn, h.priority));
    return () => unregisters.forEach(u => u());
  }

  /**
   * Get all lifecycle hooks for a given phase, sorted by priority.
   */
  getLifecycleHooks(phase: LifecyclePhase): HookFn[] {
    return (this.lifecycle.get(phase) ?? []).map(e => e.fn);
  }

  // ── Recovery Hooks ──

  /**
   * Register a recovery hook.
   */
  onRecovery(
    phase: RecoveryPhase,
    fn: HookFn,
    priority = DEFAULT_REQUEST_HOOK_PRIORITY
  ): () => void {
    const entry: RecoveryHookEntry = { phase, fn, priority };
    const existing = this.recovery.get(phase) ?? [];
    existing.push(entry);
    existing.sort((a, b) => a.priority - b.priority);
    this.recovery.set(phase, existing);
    return () => {
      const arr = this.recovery.get(phase);
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  /** Get all recovery hooks for a given phase, sorted by priority. */
  getRecoveryHooks(phase: RecoveryPhase): HookFn[] {
    return (this.recovery.get(phase) ?? []).map(e => e.fn);
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

  /**
   * Get tool hooks that have filter capability, sorted by priority.
   */
  getToolFilterHooks(): ToolHook[] {
    return this.tools.filter(h => typeof h.filter === 'function');
  }

  // ── Bulk Operations ──

  /**
   * Remove all hooks (for cleanup/destroy).
   */
  clear(): void {
    this.lifecycle.clear();
    this.recovery.clear();
    this.requests = [];
    this.tools = [];
  }
}
