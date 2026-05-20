/**
 * Runner - structured concurrency for Agent tasks
 */

import { Latch } from './latch.js';

export type RunnerState =
  | { _tag: 'Idle' }
  | { _tag: 'Running'; taskId: string; abortController: AbortController }
  | { _tag: 'Shell'; taskId: string; latch: Latch }
  | { _tag: 'ShellThenRun'; shellTask: TaskHandle; pendingTask: TaskHandle };

export interface TaskHandle {
  id: string;
  work: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export interface RunnerOptions {
  onInterrupt?: () => unknown;
}

export class Runner {
  private _state: RunnerState = { _tag: 'Idle' };
  private pendingQueue: TaskHandle[] = [];
  private taskIdCounter = 0;
  private currentResolve?: (value: unknown) => void;
  private currentReject?: (error: unknown) => void;
  private currentOnInterrupt?: () => unknown;

  get state(): RunnerState {
    return this._state;
  }

  get busy(): boolean {
    return this._state._tag !== 'Idle';
  }

  canTransition(to: 'Idle' | 'Running' | 'Shell'): boolean {
    if (this._state._tag === 'Idle') {
      return to === 'Running' || to === 'Shell';
    }
    return false;
  }

  async ensureRunning<T>(work: () => Promise<T>): Promise<T> {
    if (this._state._tag !== 'Idle') {
      return new Promise<T>((resolve, reject) => {
        this.pendingQueue.push({
          id: this.nextId(),
          work: work as () => Promise<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      });
    }

    const taskId = this.nextId();
    const abortController = new AbortController();
    this._state = { _tag: 'Running', taskId, abortController };

    return new Promise<T>((resolve, reject) => {
      this.currentResolve = resolve as (value: unknown) => void;
      this.currentReject = reject;

      work()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this._state = { _tag: 'Idle' };
          this.currentResolve = undefined;
          this.currentReject = undefined;
          this.drainQueue();
        });
    });
  }

  async startShell<T>(work: () => Promise<T>, options?: RunnerOptions): Promise<T> {
    if (this._state._tag !== 'Idle') {
      throw new Error('Runner is busy');
    }

    const taskId = this.nextId();
    const latch = new Latch();
    this._state = { _tag: 'Shell', taskId, latch };
    this.currentOnInterrupt = options?.onInterrupt;

    return new Promise<T>((resolve, reject) => {
      this.currentResolve = resolve as (value: unknown) => void;
      this.currentReject = reject;

      work()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this._state = { _tag: 'Idle' };
          this.currentResolve = undefined;
          this.currentReject = undefined;
          this.currentOnInterrupt = undefined;
        });
    });
  }

  async cancel(): Promise<void> {
    if (this._state._tag === 'Idle') return;

    const onInterrupt = this.currentOnInterrupt;
    const resolve = this.currentResolve;
    const reject = this.currentReject;

    if (this._state._tag === 'Running') {
      this._state.abortController.abort();
      this._state = { _tag: 'Idle' };
      if (reject) reject(new Error('cancelled'));
      return;
    }

    if (this._state._tag === 'Shell') {
      this._state.latch.release();
      this._state = { _tag: 'Idle' };
      // For Shell mode with onInterrupt, resolve with interrupt result
      if (onInterrupt && resolve) {
        resolve(onInterrupt());
      } else if (reject) {
        reject(new Error('cancelled'));
      }
    }
  }

  private nextId(): string {
    return `task-${++this.taskIdCounter}`;
  }

  private drainQueue(): void {
    const next = this.pendingQueue.shift();
    if (!next) return;
    this.ensureRunning(next.work as () => Promise<unknown>)
      .then(next.resolve)
      .catch(next.reject);
  }
}
