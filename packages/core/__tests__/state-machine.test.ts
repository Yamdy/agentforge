import { describe, it, expect } from 'vitest';
import { StateMachine } from '../src/state-machine.js';

describe('StateMachine', () => {
  it('starts in pending state', () => {
    const sm = new StateMachine();
    expect(sm.current).toBe('pending');
  });

  it('transitions from pending to running', () => {
    const sm = new StateMachine();
    sm.transition('running');
    expect(sm.current).toBe('running');
  });

  it('rejects invalid transition from pending to completed', () => {
    const sm = new StateMachine();
    expect(() => sm.transition('completed')).toThrow();
  });

  it('transitions running -> paused -> running', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('paused');
    expect(sm.current).toBe('paused');
    sm.transition('running');
    expect(sm.current).toBe('running');
  });

  it('transitions running -> completed (terminal)', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('completed');
    expect(sm.current).toBe('completed');
    expect(() => sm.transition('running')).toThrow();
  });

  it('transitions running -> cancelled (terminal)', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('cancelled');
    expect(() => sm.transition('running')).toThrow();
  });

  it('transitions running -> error (recoverable)', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('error', Object.assign(new Error('timeout'), { recoverable: true, retryCount: 0, maxRetries: 3 }));
    expect(sm.current).toBe('error');
    sm.transition('running', Object.assign(new Error('retry'), { recoverable: true, retryCount: 1, maxRetries: 3 }));
    expect(sm.current).toBe('running');
  });

  it('rejects error -> running when not recoverable', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('error', Object.assign(new Error('config error'), { recoverable: false }));
    expect(() => sm.transition('running')).toThrow();
  });

  it('rejects error -> running when max retries exceeded', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('error', Object.assign(new Error('timeout'), { recoverable: true, retryCount: 3, maxRetries: 3 }));
    expect(() => sm.transition('running')).toThrow();
  });

  it('fires onTransition callback', () => {
    const transitions: Array<{ from: string; to: string }> = [];
    const sm = new StateMachine();
    sm.onTransition((from, to) => transitions.push({ from, to }));
    sm.transition('running');
    sm.transition('completed');
    expect(transitions).toEqual([
      { from: 'pending', to: 'running' },
      { from: 'running', to: 'completed' },
    ]);
  });

  it('onTransition unsubscribe stops callbacks', () => {
    const transitions: Array<{ from: string; to: string }> = [];
    const sm = new StateMachine();
    const unsub = sm.onTransition((from, to) => transitions.push({ from, to }));
    sm.transition('running');
    unsub();
    sm.transition('completed');
    expect(transitions).toEqual([{ from: 'pending', to: 'running' }]);
  });

  it('canTransition returns true for valid transitions', () => {
    const sm = new StateMachine();
    expect(sm.canTransition('running')).toBe(true);
    expect(sm.canTransition('completed')).toBe(false);
  });

  it('canTransition returns false for terminal state', () => {
    const sm = new StateMachine();
    sm.transition('running');
    sm.transition('completed');
    expect(sm.canTransition('running')).toBe(false);
    expect(sm.canTransition('cancelled')).toBe(false);
  });
});
