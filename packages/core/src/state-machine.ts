import type { AgentForgeError } from './errors.js';

export type AgentState = 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  pending: ['running'],
  running: ['paused', 'completed', 'cancelled', 'error'],
  paused: ['running', 'cancelled'],
  completed: ['pending'],
  cancelled: ['pending'],
  error: ['pending'],
};

export class StateMachine {
  private _current: AgentState = 'pending';
  private _lastError?: AgentForgeError;
  private listeners: Array<(from: AgentState, to: AgentState) => void> = [];

  get current(): AgentState {
    return this._current;
  }

  canTransition(to: AgentState, error?: AgentForgeError): boolean {
    if (to === 'running' && this._current === 'error') {
      return this.isRecoverable(error ?? this._lastError);
    }
    return VALID_TRANSITIONS[this._current]?.includes(to) ?? false;
  }

  transition(to: AgentState, error?: AgentForgeError): void {
    if (!this.canTransition(to, error)) {
      throw new Error(`Invalid state transition: ${this._current} -> ${to}`);
    }
    const from = this._current;
    this._current = to;
    if (to === 'error') this._lastError = error;
    for (const cb of this.listeners) cb(from, to);
  }

  onTransition(cb: (from: AgentState, to: AgentState) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private isRecoverable(error?: AgentForgeError): boolean {
    if (!error || !error.recoverable) return false;
    const retryCount = error.retryCount ?? 0;
    const maxRetries = error.maxRetries ?? 3;
    return retryCount < maxRetries;
  }
}
