export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxRequests?: number;
}

export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  failureCount: number;
  failureThreshold: number;
  resetTimeout: number;
  openedAt?: number;
}

type EventHandler = (data?: unknown) => void;

export class CircuitBreaker {
  private _state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private failureThreshold: number;
  private resetTimeout: number;
  private halfOpenMaxRequests: number;
  private halfOpenCount = 0;
  private openedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handlers = new Map<string, Set<EventHandler>>();

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.resetTimeout = config.resetTimeout ?? 30000;
    this.halfOpenMaxRequests = config.halfOpenMaxRequests ?? 1;

    if (this.failureThreshold < 0) throw new Error('failureThreshold must be >= 0');
    if (this.resetTimeout <= 0) throw new Error('resetTimeout must be > 0');
    if (this.halfOpenMaxRequests <= 0) throw new Error('halfOpenMaxRequests must be > 0');
  }

  get state(): CircuitBreakerState {
    return this._state;
  }

  on(eventType: string, handler: EventHandler): () => void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  private emit(eventType: string, data?: unknown): void {
    const set = this.handlers.get(eventType);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(data);
      } catch {
        // isolate handler errors
      }
    }
  }

  checkBeforeCall(): boolean {
    if (this._state === 'closed') return true;
    if (this._state === 'open') {
      this.emit('circuit:rejected', { reason: 'circuit_open' });
      return false;
    }
    if (this.halfOpenCount >= this.halfOpenMaxRequests) {
      this.emit('circuit:rejected', { reason: 'half_open_limit' });
      return false;
    }
    this.halfOpenCount++;
    return true;
  }

  recordSuccess(): void {
    if (this._state === 'half_open') {
      this.transitionTo('closed');
      this.emit('circuit:closed', {});
    }
    this.failureCount = 0;
  }

  recordFailure(): void {
    if (this._state === 'open') return;

    this.failureCount++;

    if (this._state === 'half_open') {
      this.transitionTo('open');
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  reset(): void {
    this.clearTimer();
    this.transitionTo('closed');
    this.emit('circuit:closed', {});
  }

  destroy(): void {
    this.clearTimer();
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this._state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
      openedAt: this._state === 'open' ? this.openedAt : undefined,
    };
  }

  static fromSnapshot(snap: CircuitBreakerSnapshot): CircuitBreaker {
    const cb = new CircuitBreaker({
      failureThreshold: snap.failureThreshold,
      resetTimeout: snap.resetTimeout,
    });
    cb._state = snap.state;
    cb.failureCount = snap.failureCount;
    if (snap.state === 'open' && snap.openedAt) {
      cb.openedAt = snap.openedAt;
      cb.scheduleHalfOpen();
    }
    return cb;
  }

  private transitionTo(state: CircuitBreakerState): void {
    if (this._state === state) return;
    this._state = state;

    if (state === 'open') {
      this.openedAt = Date.now();
      this.emit('circuit:opened', { failureCount: this.failureCount });
      this.scheduleHalfOpen();
    }

    if (state === 'half_open') {
      this.failureCount = 0;
      this.halfOpenCount = 0;
      this.emit('circuit:half_open', {});
    }

    if (state === 'closed') {
      this.failureCount = 0;
      this.halfOpenCount = 0;
    }
  }

  private scheduleHalfOpen(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.transitionTo('half_open');
    }, this.resetTimeout);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
