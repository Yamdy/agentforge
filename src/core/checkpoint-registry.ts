/**
 * CheckpointRegistry — Declarative Cross-Cutting Concern Wiring
 *
 * Implements R6 iron law: all Harness cross-cutting concerns (quota, rate
 * limiting, quality gate, circuit breaker, etc.) register for lifecycle
 * phases instead of ad-hoc `if (ctx.X)` in the main loop.
 *
 * Architecture:
 *   MPU modules register → CheckpointRegistry
 *   Agent loop executes → registry.run(phase, ctx, state)
 *
 * This prevents wiring omissions and makes the full set of active
 * concern checkpoints compile-time verifiable.
 */

import type { AgentContext } from './context.js';
import type { AgentState } from './state.js';

// ============================================================
// Types
// ============================================================

/**
 * Lifecycle phase where cross-cutting checks execute.
 *
 * - pre-llm: Before each LLM call (quota, rate-limit)
 * - post-llm: After each LLM response (quality gate, circuit breaker success)
 */
export type LifecyclePhase = 'pre-llm' | 'post-llm';

/**
 * Result of a checkpoint execution.
 *
 * - continue: Proceed normally.
 * - block:   Stop the current phase. 'retry' reasons allow the
 *            loop to continue (e.g., quality gate injection),
 *            while all other reasons terminate with error.
 */
export type CheckpointResult = { action: 'continue' } | { action: 'block'; reason: string };

// ============================================================
// Checkpoint Function Type
// ============================================================

/**
 * A cross-cutting concern checkpoint function.
 *
 * Receives the agent context, loop state, and optional phase-specific
 * extra arguments (e.g., the LLM response object for post-llm phase).
 *
 * MUST NOT throw — errors should be handled internally.
 */
export type CheckpointFn = (
  ctx: AgentContext,
  state: AgentState,
  ...args: unknown[]
) => CheckpointResult | Promise<CheckpointResult>;

// ============================================================
// CheckpointRegistry
// ============================================================

/**
 * Declarative registry for cross-cutting lifecycle checkpoints.
 *
 * MPU modules register checkpoints with a priority (lower runs first).
 * The agent loop executes all checkpoints for a given phase in priority
 * order at the appropriate lifecycle point.
 *
 * Usage:
 * ```typescript
 * const registry = new CheckpointRegistry();
 *
 * registry.register('pre-llm', 10, async (ctx, state) => {
 *   if (ctx.controls.quota) { ... }
 *   return { action: 'continue' };
 * });
 *
 * const result = await registry.run('pre-llm', ctx, state);
 * if (result.action === 'block') {
 *   // Handle terminal/retry block
 * }
 * ```
 */
export class CheckpointRegistry {
  private readonly _registrations = new Map<
    LifecyclePhase,
    Array<{ priority: number; fn: CheckpointFn }>
  >();

  /**
   * Register a checkpoint function for a lifecycle phase.
   *
   * @param phase    Lifecycle phase to register for
   * @param priority Execution order (lower runs first). Default: 0.
   * @param fn       Checkpoint function
   * @returns        Unregister function
   */
  register(phase: LifecyclePhase, priority: number, fn: CheckpointFn): () => void {
    let entries = this._registrations.get(phase);
    if (!entries) {
      entries = [];
      this._registrations.set(phase, entries);
    }

    const entry = { priority, fn };
    entries.push(entry);
    entries.sort((a, b) => a.priority - b.priority);

    const captured = entries;
    return () => {
      const idx = captured.indexOf(entry);
      if (idx !== -1) {
        captured.splice(idx, 1);
      }
    };
  }

  /**
   * Execute all registered checkpoints for a phase.
   *
   * Runs checkpoints in priority order (lowest first). Stops at the
   * first '{ action: 'block' }' result.
   *
   * @param phase  Lifecycle phase to execute
   * @param ctx    Agent context
   * @param state  Current loop state
   * @param args   Phase-specific extra arguments
   * @returns      First block result or 'continue' if all pass
   */
  async run(
    phase: LifecyclePhase,
    ctx: AgentContext,
    state: AgentState,
    ...args: unknown[]
  ): Promise<CheckpointResult> {
    const entries = this._registrations.get(phase);
    if (!entries || entries.length === 0) {
      return { action: 'continue' };
    }

    for (const entry of entries) {
      try {
        const result = await entry.fn(ctx, state, ...args);
        if (result.action === 'block') {
          return result;
        }
      } catch {
        // R2: Hook exception isolation — never let one checkpoint
        // crash the entire phase. Log and continue.
      }
    }

    return { action: 'continue' };
  }

  /**
   * Get the number of registered checkpoints for a phase.
   */
  getCount(phase: LifecyclePhase): number {
    return this._registrations.get(phase)?.length ?? 0;
  }

  /**
   * Get total number of registered checkpoints across all phases.
   */
  getTotalCount(): number {
    let total = 0;
    for (const entries of this._registrations.values()) {
      total += entries.length;
    }
    return total;
  }

  /**
   * Remove all checkpoints for a phase (or all phases if omitted).
   */
  clear(phase?: LifecyclePhase): void {
    if (phase) {
      this._registrations.delete(phase);
    } else {
      this._registrations.clear();
    }
  }
}
