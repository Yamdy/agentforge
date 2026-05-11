import { describe, it, expect } from 'vitest';
import { resolveDynamic } from '../src/dynamic-resolver.js';
import type { ResolveContext } from '@agentforge/sdk';

const baseCtx: ResolveContext = {
  input: 'hello',
  sessionId: 's1',
  metadata: {},
};

describe('resolveDynamic', () => {
  it('returns static value unchanged', async () => {
    const result = await resolveDynamic('hello', baseCtx);
    expect(result).toBe('hello');
  });

  it('calls function value and returns result', async () => {
    const result = await resolveDynamic((ctx) => ctx.input.toUpperCase(), baseCtx);
    expect(result).toBe('HELLO');
  });

  it('handles async function value', async () => {
    const result = await resolveDynamic(
      async (ctx) => Promise.resolve(`async:${ctx.sessionId}`),
      baseCtx,
    );
    expect(result).toBe('async:s1');
  });

  it('handles object static value', async () => {
    const obj = { model: 'claude-3', maxIterations: 5 };
    const result = await resolveDynamic(obj, baseCtx);
    expect(result).toEqual(obj);
  });

  it('handles array static value', async () => {
    const arr = ['a', 'b'];
    const result = await resolveDynamic(arr, baseCtx);
    expect(result).toEqual(arr);
  });
});
