import { describe, it, expect } from 'vitest';
import { suspend, isSuspended } from '../../src/workflow/suspend';

describe('suspend', () => {
  it('should create a suspend result with state', () => {
    const state = { step: 'waiting-for-approval', input: 'approve' };
    const result = suspend(state, 'Waiting for user approval');

    expect(result.suspended).toBe(true);
    expect(result.state).toEqual(state);
    expect(result.message).toBe('Waiting for user approval');
  });

  it('should work without message', () => {
    const state = { data: 'test' };
    const result = suspend(state);

    expect(result.suspended).toBe(true);
    expect(result.state).toEqual({ data: 'test' });
    expect(result.message).toBeUndefined();
  });
});

describe('isSuspended', () => {
  it('should return true for suspended result', () => {
    const result = suspend({ foo: 'bar' });
    expect(isSuspended(result)).toBe(true);
  });

  it('should return false for non-suspended result', () => {
    expect(isSuspended(null)).toBe(false);
    expect(isSuspended('string')).toBe(false);
    expect(isSuspended(undefined)).toBe(false);
    expect(isSuspended({ foo: 'bar' })).toBe(false);
  });
});
