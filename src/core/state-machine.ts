/**
 * AgentForge State Machine
 *
 * 6-state model with transition validation.
 * Terminal states are irreversible.
 *
 * State Transitions:
 *   pending   → [running]
 *   running   → [paused, completed, cancelled, error]
 *   paused    → [running, cancelled]
 *   completed → [] (terminal)
 *   cancelled → [] (terminal)
 *   error     → [] (terminal)
 *
 * @module
 */

export type AgentStateEnum = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

export const AGENT_STATES: readonly AgentStateEnum[] = [
  'pending',
  'running',
  'paused',
  'completed',
  'cancelled',
  'error',
] as const;

const VALID_TRANSITIONS: Record<AgentStateEnum, readonly AgentStateEnum[]> = {
  pending: Object.freeze(['running']),
  running: Object.freeze(['paused', 'completed', 'cancelled', 'error']),
  paused: Object.freeze(['running', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
  error: Object.freeze([]),
};

/**
 * State machine for agent lifecycle management.
 *
 * Provides:
 * - State tracking with immutable transitions
 * - Transition validation (only valid paths allowed)
 * - Listener notifications on state changes
 * - Terminal state protection (no transitions from completed/cancelled/error)
 */
export class AgentStateMachine {
  private _state: AgentStateEnum = 'pending';
  private _listeners: Array<(from: AgentStateEnum, to: AgentStateEnum) => void> = [];

  /** Current state */
  get state(): AgentStateEnum {
    return this._state;
  }

  /** Check if current state is terminal (completed, cancelled, or error) */
  isTerminal(): boolean {
    return this._state === 'completed' || this._state === 'cancelled' || this._state === 'error';
  }

  /**
   * Attempt a state transition.
   *
   * @param to - Target state
   * @returns true if transition succeeded, false if invalid
   *
   * Invalid transitions:
   * - From terminal state (completed/cancelled/error)
   * - To state not in valid transitions for current state
   */
  transition(to: AgentStateEnum): boolean {
    if (this.isTerminal()) return false;
    if (!VALID_TRANSITIONS[this._state].includes(to)) return false;

    const from = this._state;
    this._state = to;

    // Notify listeners (errors are swallowed to prevent affecting state machine)
    for (const listener of this._listeners) {
      try {
        listener(from, to);
      } catch {
        // Listener errors must not affect state machine operation
      }
    }

    return true;
  }

  /**
   * Subscribe to state change notifications.
   *
   * @param listener - Callback receiving (from, to) states
   * @returns Unsubscribe function
   */
  onChange(listener: (from: AgentStateEnum, to: AgentStateEnum) => void): () => void {
    this._listeners.push(listener);
    // Return unsubscribe function
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Reset state machine to initial state.
   *
   * WARNING: Only for testing purposes. Production code should never reset.
   */
  reset(): void {
    this._state = 'pending';
    this._listeners.length = 0;
  }
}

/**
 * Check if a transition from one state to another is valid.
 *
 * @param from - Current state
 * @param to - Target state
 * @returns true if transition is allowed
 */
export function isValidTransition(from: AgentStateEnum, to: AgentStateEnum): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Get all valid transitions from a given state.
 *
 * @param from - Current state
 * @returns Array of valid target states (empty for terminal states)
 */
export function getValidTransitions(from: AgentStateEnum): readonly AgentStateEnum[] {
  return VALID_TRANSITIONS[from];
}
