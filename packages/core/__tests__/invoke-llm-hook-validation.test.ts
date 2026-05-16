import { describe, it, expect } from 'vitest';
import { validateLlmHookOutput } from '../src/processors/invoke-llm.js';

describe('validateLlmHookOutput', () => {
  it('returns original messages when hook output is empty', () => {
    const original = [{ role: 'user', content: 'hello' }];
    const result = validateLlmHookOutput(undefined, original);
    expect(result).toBe(original);
  });

  it('returns original messages when hook sets messages to empty array', () => {
    const original = [{ role: 'user', content: 'hello' }];
    const result = validateLlmHookOutput([], original);
    expect(result).toBe(original);
  });

  it('returns hook messages when they are valid non-empty array', () => {
    const original = [{ role: 'user', content: 'hello' }];
    const hookMessages = [{ role: 'user', content: 'modified' }];
    const result = validateLlmHookOutput(hookMessages, original);
    expect(result).toBe(hookMessages);
  });

  it('returns original messages when hook sets messages to non-array', () => {
    const original = [{ role: 'user', content: 'hello' }];
    const result = validateLlmHookOutput('not an array' as unknown as unknown[], original);
    expect(result).toBe(original);
  });

  it('returns original messages when hook sets messages to null', () => {
    const original = [{ role: 'user', content: 'hello' }];
    const result = validateLlmHookOutput(null as unknown as unknown[], original);
    expect(result).toBe(original);
  });
});
