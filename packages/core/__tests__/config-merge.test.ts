import { describe, it, expect } from 'vitest';
import { deepMerge } from '../src/config-merge.js';

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('later values override same keys', () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result).toEqual({ a: 2 });
  });

  it('merges nested objects recursively', () => {
    const result = deepMerge(
      { agents: { default: { model: 'a' } } },
      { agents: { default: { maxIterations: 5 } } },
    );
    expect(result).toEqual({
      agents: { default: { model: 'a', maxIterations: 5 } },
    });
  });

  it('arrays do NOT merge — later replaces', () => {
    const result = deepMerge({ plugins: ['a'] }, { plugins: ['b'] });
    expect(result).toEqual({ plugins: ['b'] });
  });

  it('handles undefined/null sources gracefully', () => {
    const result = deepMerge({ a: 1 }, undefined as any, null as any, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('merges three or more sources left to right', () => {
    const result = deepMerge({ a: 1 }, { b: 2 }, { a: 3, c: 4 });
    expect(result).toEqual({ a: 3, b: 2, c: 4 });
  });

  it('does not mutate the target', () => {
    const target = { a: 1, nested: { x: 1 } };
    const source = { a: 2, nested: { y: 2 } };
    const result = deepMerge(target, source);
    expect(target).toEqual({ a: 1, nested: { x: 1 } });
    expect(result).toEqual({ a: 2, nested: { x: 1, y: 2 } });
  });
});
